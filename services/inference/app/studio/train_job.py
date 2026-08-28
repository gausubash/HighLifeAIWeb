from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.config import get_settings
from app.studio.dataset import (
    assert_base_model,
    extract_dataset_zip,
    floordata_base_kind,
    is_floordata_base,
    is_mitunet_base,
    is_retinanet_base,
    is_torchvision_detect_base,
    prepare_yolo_dataset,
    resolve_yolo_checkpoint,
    torchvision_detect_kind,
)
from app.studio.supabase_io import (
    StudioApiError,
    StudioAuth,
    download_object,
    rest_get,
    rest_patch,
    rest_post,
    upload_object,
)

logger = logging.getLogger(__name__)

_train_lock = threading.Lock()
CACHE_DIR = Path(__file__).resolve().parents[2] / "models" / "studio_cache"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def default_finetuned_model_name(base_model: str, when: datetime | None = None) -> str:
    """e.g. ``yolov8n-seg fine-tuned 2026-08-26 1241`` (local date + HHMM)."""
    leaf = Path(str(base_model or "model")).name
    stem = leaf.rsplit(".", 1)[0] if "." in leaf else leaf
    stem = stem.strip() or "model"
    stamp = when or datetime.now().astimezone()
    return f"{stem} fine-tuned {stamp.strftime('%Y-%m-%d %H%M')}"


def resolve_model_name(job: dict, *, dataset_name: str, task: str, base_model: str) -> str:
    custom = str(job.get("model_name") or "").strip()
    if custom:
        return custom
    return default_finetuned_model_name(base_model)


def _metrics_from_run(run_dir: Path) -> dict:
    results = run_dir / "results.csv"
    if not results.is_file():
        return {}
    lines = results.read_text(encoding="utf-8").strip().splitlines()
    if len(lines) < 2:
        return {"rows": len(lines)}
    headers = [part.strip() for part in lines[0].split(",")]
    values = [part.strip() for part in lines[-1].split(",")]
    last = dict(zip(headers, values, strict=False))
    interesting = {
        key: last[key]
        for key in last
        if any(token in key.lower() for token in ("map", "precision", "recall", "box", "mask", "loss"))
    }
    return interesting or last


def _pick_sample_image(data_yaml: Path) -> Path | None:
    try:
        import yaml

        data = yaml.safe_load(data_yaml.read_text(encoding="utf-8")) or {}
    except Exception:
        return None
    root = Path(str(data.get("path") or data_yaml.parent))
    for key in ("val", "train"):
        rel = data.get(key)
        if not rel:
            continue
        folder = root / str(rel)
        if not folder.is_dir():
            continue
        for path in sorted(folder.rglob("*")):
            if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}:
                return path
    return None


def _write_segmentation_preview(
    *,
    weights: Path,
    sample: Path,
    out_path: Path,
    imgsz: int = 640,
) -> bool:
    """Run current weights on a sample page and save an overlay PNG for the Train UI.

    Always loads a **fresh** YOLO instance — never call ``predict`` on the model
    that is actively training (that breaks ``loss.backward()`` on the next epoch).
    """
    try:
        from PIL import Image
        import numpy as np
        import shutil
        import tempfile
        import time
        from ultralytics import YOLO
    except ImportError:
        return False
    if not weights.is_file() or not sample.is_file():
        return False

    def _predict_with_model(model) -> bool:
        result = model.predict(
            source=str(sample),
            imgsz=min(int(imgsz), 640),
            conf=0.15,
            verbose=False,
        )[0]
        plotted = result.plot()  # BGR ndarray
        rgb = plotted[:, :, ::-1]
        out_path.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(np.ascontiguousarray(rgb)).save(out_path, format="PNG")
        return out_path.is_file()

    last_err: Exception | None = None
    for attempt in range(6):
        try:
            with tempfile.TemporaryDirectory() as td:
                tmp_w = Path(td) / "preview_weights.pt"
                shutil.copy2(weights, tmp_w)
                model = YOLO(str(tmp_w))
                return _predict_with_model(model)
        except OSError as exc:
            last_err = exc
            time.sleep(0.15 * (attempt + 1))
        except Exception as exc:
            last_err = exc
            break

    try:
        model = YOLO(str(weights))
        return _predict_with_model(model)
    except Exception as exc:
        last_err = exc

    logger.exception("Could not write training preview from %s: %s", weights, last_err)
    return False


def train_yolo_detect(
    *,
    data_yaml: Path,
    weights_out: Path,
    epochs: int,
    imgsz: int,
    batch: int,
    device: str,
    model: str,
    project: Path,
    name: str,
    on_epoch=None,
) -> Path:
    from ultralytics import YOLO

    yolo = YOLO(model)
    sample = _pick_sample_image(data_yaml)

    def _on_epoch(trainer) -> None:
        if on_epoch is None:
            return
        total = max(1, int(getattr(trainer.args, "epochs", epochs) or epochs))
        current = int(getattr(trainer, "epoch", 0)) + 1
        run_dir = Path(getattr(trainer, "save_dir", project / name))
        last_w = run_dir / "weights" / "last.pt"
        metrics = _metrics_from_run(run_dir)
        # Prefer live trainer metrics when CSV is still catching up.
        live = getattr(trainer, "metrics", None) or {}
        if isinstance(live, dict):
            for key, value in live.items():
                try:
                    metrics[str(key)] = float(value)
                except (TypeError, ValueError):
                    metrics[str(key)] = value
        on_epoch(current, total, metrics=metrics, last_weights=last_w if last_w.is_file() else None, sample=sample)

    yolo.add_callback("on_train_epoch_end", _on_epoch)
    yolo.train(
        data=str(data_yaml),
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        device=0 if device == "cuda" else "cpu",
        workers=0,
        project=str(project),
        name=name,
        exist_ok=True,
        patience=max(5, epochs // 3),
        plots=True,
    )
    run_dir = project / name
    best = run_dir / "weights" / "best.pt"
    last = run_dir / "weights" / "last.pt"
    src = best if best.is_file() else last
    if not src.is_file():
        raise FileNotFoundError(f"Training finished but no weights in {run_dir / 'weights'}")
    weights_out.parent.mkdir(parents=True, exist_ok=True)
    weights_out.write_bytes(src.read_bytes())
    return weights_out


def _pretrained_retinanet_path() -> Path:
    from app.config import get_settings
    from app.yolo.wall_registry import resolve_legacy_wall_weights_for_backend

    path = Path(resolve_legacy_wall_weights_for_backend(get_settings(), "retinanet"))
    return path


def _pretrained_torchvision_path(kind: str) -> Path:
    from app.config import get_settings
    from app.yolo.wall_registry import resolve_legacy_wall_weights_for_backend

    backend = {
        "retinanet": "retinanet",
        "faster_rcnn": "faster_rcnn",
        "cascade_swin": "cascade_swin",
    }.get(kind, kind)
    return Path(resolve_legacy_wall_weights_for_backend(get_settings(), backend))


def _pretrained_floordata_path(kind: str) -> Path:
    from app.config import get_settings
    from app.yolo.wall_registry import resolve_legacy_wall_weights_for_backend

    backend = "deeplab" if kind == "deeplab" else "unet_floordata"
    return Path(resolve_legacy_wall_weights_for_backend(get_settings(), backend))


def _pretrained_mitunet_path() -> Path:
    from app.yolo.mitunet import ensure_mitunet_weights

    return ensure_mitunet_weights(get_settings())


def _run_selected_trainer(
    *,
    base_model: str,
    data_yaml: Path,
    weights_out: Path,
    class_names: list[str],
    epochs: int,
    imgsz: int,
    batch: int,
    device: str,
    project: Path,
    name: str,
    on_epoch,
    preview_path: Path | None = None,
) -> Path:
    kind = floordata_base_kind(base_model)
    if kind:
        from app.studio.tf_runtime import train_floordata_with_runtime

        return train_floordata_with_runtime(
            kind=kind,
            data_yaml=data_yaml,
            weights_out=weights_out,
            pretrained_path=_pretrained_floordata_path(kind),
            class_names=class_names,
            epochs=epochs,
            imgsz=imgsz,
            batch=batch,
            device=device,
            project=project,
            name=name,
            on_epoch=on_epoch,
            preview_path=preview_path,
        )
    tv_kind = torchvision_detect_kind(base_model)
    if tv_kind:
        from app.studio.retinanet import train_torchvision_detector

        return train_torchvision_detector(
            kind=tv_kind,
            data_yaml=data_yaml,
            weights_out=weights_out,
            pretrained_path=_pretrained_torchvision_path(tv_kind),
            class_names=class_names,
            epochs=epochs,
            imgsz=imgsz,
            batch=batch,
            device=device,
            project=project,
            name=name,
            on_epoch=on_epoch,
            preview_path=preview_path,
        )
    if is_mitunet_base(base_model):
        from app.studio.mitunet_train import train_mitunet

        return train_mitunet(
            data_yaml=data_yaml,
            weights_out=weights_out,
            pretrained_path=_pretrained_mitunet_path(),
            class_names=class_names,
            epochs=epochs,
            imgsz=imgsz,
            batch=batch,
            device=device,
            project=project,
            name=name,
            on_epoch=on_epoch,
            preview_path=preview_path,
        )
    return train_yolo_detect(
        data_yaml=data_yaml,
        weights_out=weights_out,
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        device=device,
        model=resolve_yolo_checkpoint(base_model),
        project=project,
        name=name,
        on_epoch=on_epoch,
    )


def run_training_job(auth: StudioAuth, job_id: str) -> None:
    if not _train_lock.acquire(blocking=False):
        rest_patch(
            auth,
            "ml_training_jobs",
            job_id,
            {
                "status": "failed",
                "error": "Another training job is already running on this machine.",
                "finished_at": _now(),
            },
        )
        return
    try:
        _run_training_job_locked(auth, job_id)
    except Exception as exc:
        logger.exception("Training job %s failed", job_id)
        try:
            rest_patch(
                auth,
                "ml_training_jobs",
                job_id,
                {
                    "status": "failed",
                    "error": str(exc),
                    "finished_at": _now(),
                },
            )
        except Exception:
            logger.exception("Could not mark training job %s as failed", job_id)
    finally:
        _train_lock.release()


def _run_training_job_locked(auth: StudioAuth, job_id: str) -> None:
    from tempfile import TemporaryDirectory

    rows = rest_get(auth, "ml_training_jobs", f"id=eq.{job_id}&select=*")
    if not rows:
        raise StudioApiError("Training job not found.", status=404)
    job = rows[0]
    datasets = rest_get(auth, "ml_datasets", f"id=eq.{job['dataset_id']}&select=*")
    if not datasets:
        raise StudioApiError("Dataset not found.", status=404)
    dataset = datasets[0]
    storage_path = dataset.get("storage_path")
    if not storage_path:
        raise StudioApiError("Dataset has no uploaded ZIP yet.")

    task = job["task"]
    base_model = assert_base_model(task, job.get("base_model") or "")
    class_names = list(dataset.get("class_names") or [])
    if not class_names:
        raise StudioApiError("Dataset has no class names.")

    rest_patch(
        auth,
        "ml_training_jobs",
        job_id,
        {"status": "running", "progress": 5, "started_at": _now(), "error": None},
    )

    settings = get_settings()
    device = settings.device.value
    zip_bytes = download_object(auth, "datasets", storage_path)

    with TemporaryDirectory(prefix="highlife-train-") as tmp:
        tmp_path = Path(tmp)
        extracted = extract_dataset_zip(zip_bytes, tmp_path / "raw")
        data_yaml = prepare_yolo_dataset(extracted, class_names, task=task)
        rest_patch(auth, "ml_training_jobs", job_id, {"progress": 15, "log_tail": "Dataset prepared."})

        run_name = f"job-{job_id[:8]}"
        project = tmp_path / "runs"
        weights_out = tmp_path / "best.pt"

        def on_epoch(current: int, total: int, **_kwargs) -> None:
            pct = 15 + int(current / max(1, total) * 70)
            rest_patch(
                auth,
                "ml_training_jobs",
                job_id,
                {
                    "progress": min(85, pct),
                    "log_tail": f"Epoch {current}/{total}",
                },
            )

        _run_selected_trainer(
            base_model=base_model,
            data_yaml=data_yaml,
            weights_out=weights_out,
            class_names=class_names,
            epochs=int(job.get("epochs") or 30),
            imgsz=int(job.get("imgsz") or 640),
            batch=int(job.get("batch") or 2),
            device=device,
            project=project,
            name=run_name,
            on_epoch=on_epoch,
        )

        rest_patch(auth, "ml_training_jobs", job_id, {"progress": 90, "log_tail": "Uploading weights."})
        owner_id = job["owner_id"]
        model_id = str(uuid4())
        object_path = f"{owner_id}/models/{model_id}/best.pt"
        upload_object(auth, "models", object_path, weights_out.read_bytes(), "application/octet-stream")

        metrics = _metrics_from_run(project / run_name)
        model_row = rest_post(
            auth,
            "ml_models",
            {
                "id": model_id,
                "owner_id": owner_id,
                "dataset_id": dataset["id"],
                "training_job_id": job_id,
                "name": resolve_model_name(
                    job,
                    dataset_name=str(dataset.get("name") or "dataset"),
                    task=task,
                    base_model=base_model,
                ),
                "task": task,
                "architecture": base_model,
                "storage_path": object_path,
                "class_names": class_names,
                "metrics": metrics,
                "is_active": False,
            },
        )
        rest_patch(
            auth,
            "ml_training_jobs",
            job_id,
            {
                "status": "completed",
                "progress": 100,
                "output_model_id": model_row.get("id") or model_id,
                "metrics": metrics,
                "log_tail": "Training complete.",
                "finished_at": _now(),
            },
        )


def run_local_training_job(job_id: str) -> None:
    from app.studio import local_store as store

    if not _train_lock.acquire(blocking=False):
        store.patch_job(
            job_id,
            {
                "status": "failed",
                "error": "Another training job is already running on this machine.",
                "finished_at": _now(),
            },
        )
        return
    try:
        _run_local_training_job_locked(job_id)
    except Exception as exc:
        logger.exception("Local training job %s failed", job_id)
        try:
            store.patch_job(
                job_id,
                {"status": "failed", "error": str(exc), "finished_at": _now()},
            )
        except Exception:
            logger.exception("Could not mark local training job %s as failed", job_id)
    finally:
        _train_lock.release()


def _run_local_training_job_locked(job_id: str) -> None:
    from app.studio import local_store as store

    job = store.get_job(job_id)
    dataset = store.get_dataset(job["dataset_id"])
    pages_src = store.labeled_pages_dir(job["dataset_id"])
    task = job["task"]
    base_model = assert_base_model(task, job.get("base_model") or "")
    class_names = list(dataset.get("class_names") or [])
    if not class_names:
        raise store.StudioStoreError("Dataset has no class names.")

    artifacts = store.job_artifacts_dir(job_id)
    preview_path = artifacts / "preview.png"
    store.patch_job(
        job_id,
        {
            "status": "running",
            "progress": 5,
            "started_at": _now(),
            "error": None,
            "metrics_history": [],
            "preview_epoch": None,
            "preview_updated_at": None,
            "log_tail": "Preparing dataset…",
        },
    )

    settings = get_settings()
    data_yaml = prepare_yolo_dataset(pages_src, class_names, task=task)
    store.patch_job(job_id, {"progress": 15, "log_tail": "Dataset prepared — starting epochs…"})

    run_name = f"job-{job_id[:8]}"
    project = artifacts / "runs"
    weights_out = artifacts / ("best.h5" if is_floordata_base(base_model) else "best.pt")
    imgsz = int(job.get("imgsz") or 640)

    def on_epoch(current: int, total: int, **kwargs) -> None:
        pct = 15 + int(current / max(1, total) * 70)
        metrics = dict(kwargs.get("metrics") or {})
        history = list(store.get_job(job_id).get("metrics_history") or [])
        row = {"epoch": current, **{k: metrics[k] for k in list(metrics)[:24]}}
        history.append(row)
        history = history[-80:]
        last_w = kwargs.get("last_weights")
        sample = kwargs.get("sample")
        preview_ok = bool(kwargs.get("preview_ok"))
        if (
            not preview_ok
            and last_w
            and sample
            and not is_torchvision_detect_base(base_model)
            and not is_floordata_base(base_model)
            and not is_mitunet_base(base_model)
        ):
            preview_ok = _write_segmentation_preview(
                weights=Path(last_w),
                sample=Path(sample),
                out_path=preview_path,
                imgsz=imgsz,
            )
        patch: dict[str, object] = {
            "progress": min(85, pct),
            "log_tail": f"Epoch {current}/{total}"
            + (f" · preview updated" if preview_ok else ""),
            "metrics": metrics or None,
            "metrics_history": history,
            "preview_epoch": current if preview_ok else store.get_job(job_id).get("preview_epoch"),
        }
        if preview_ok:
            patch["preview_updated_at"] = _now()
        store.patch_job(job_id, patch)

    _run_selected_trainer(
        base_model=base_model,
        data_yaml=data_yaml,
        weights_out=weights_out,
        class_names=class_names,
        epochs=int(job.get("epochs") or 30),
        imgsz=imgsz,
        batch=int(job.get("batch") or 2),
        device=settings.device.value,
        project=project,
        name=run_name,
        on_epoch=on_epoch,
        preview_path=preview_path,
    )

    store.patch_job(job_id, {"progress": 90, "log_tail": "Saving weights on this PC."})
    # Final preview from best weights.
    sample = _pick_sample_image(data_yaml)
    final_preview_ok = False
    if sample and weights_out.is_file():
        if is_torchvision_detect_base(base_model):
            from app.studio.retinanet import _write_preview, load_studio_torchvision_detector

            model, names, torch_device, _kind, label_offset = load_studio_torchvision_detector(
                weights_out, device=settings.device.value
            )
            final_preview_ok = _write_preview(
                model,
                sample,
                preview_path,
                names,
                torch_device,
                label_offset=label_offset,
            )
        elif is_floordata_base(base_model):
            from app.studio.floordata_train import write_floordata_preview

            final_preview_ok = write_floordata_preview(weights_out, sample, preview_path, imgsz=imgsz)
        elif is_mitunet_base(base_model):
            from app.studio.mitunet_train import write_mitunet_preview_from_weights

            final_preview_ok = write_mitunet_preview_from_weights(
                weights_out,
                sample,
                preview_path,
                imgsz=imgsz,
                device=settings.device.value,
            )
        else:
            final_preview_ok = _write_segmentation_preview(
                weights=weights_out,
                sample=sample,
                out_path=preview_path,
                imgsz=imgsz,
            )
    metrics = _metrics_from_run(project / run_name)
    from app.studio.model_catalog import category_for_base

    model_family = "yolo"
    if is_floordata_base(base_model):
        model_family = "floordata"
    elif is_mitunet_base(base_model):
        model_family = "mitunet"
    elif is_torchvision_detect_base(base_model):
        model_family = "mmdet"
    model = store.save_model(
        weights=weights_out.read_bytes(),
        meta={
            "id": str(uuid4()),
            "dataset_id": dataset["id"],
            "training_job_id": job_id,
            "name": resolve_model_name(
                job,
                dataset_name=str(dataset.get("name") or "dataset"),
                task=task,
                base_model=base_model,
            ),
            "task": "segment" if is_floordata_base(base_model) or is_mitunet_base(base_model) else task,
            "architecture": base_model,
            "category": dataset.get("category")
            or category_for_base(base_model, task=task, family=model_family),
            "class_names": class_names,
            "metrics": metrics,
            "is_active": False,
        },
        filename=weights_out.name,
    )
    sidecar = weights_out.with_name("studio_meta.json")
    if sidecar.is_file():
        import shutil

        shutil.copy2(sidecar, store.model_dir(model["id"]) / "studio_meta.json")
    store.patch_job(
        job_id,
        {
            "status": "completed",
            "progress": 100,
            "output_model_id": model["id"],
            "metrics": metrics,
            "log_tail": "Training complete.",
            "finished_at": _now(),
            "preview_epoch": int(job.get("epochs") or 0) or store.get_job(job_id).get("preview_epoch"),
            **({"preview_updated_at": _now()} if final_preview_ok else {}),
        },
    )


def cache_model_weights(auth: StudioAuth, storage_path: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    local = CACHE_DIR / storage_path.replace("/", "_")
    if local.is_file() and local.stat().st_size > 0:
        return local
    data = download_object(auth, "models", storage_path)
    local.write_bytes(data)
    return local
