"""Resolve and invoke the dedicated TensorFlow CPU Python for floorData train/infer."""

from __future__ import annotations

import json
import logging
import os
import subprocess
import tempfile
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

INFERENCE_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_TF_VENV_PYTHON = INFERENCE_ROOT / (
    ".venv-tf/Scripts/python.exe" if os.name == "nt" else ".venv-tf/bin/python"
)


def resolve_tensorflow_python() -> Path | None:
    """Return a Python 3.10–3.12 interpreter with TensorFlow, if configured."""
    from app.config import get_settings

    configured = (get_settings().tensorflow_python or "").strip()
    candidates: list[Path] = []
    if configured:
        candidates.append(Path(configured))
    candidates.append(DEFAULT_TF_VENV_PYTHON)
    for path in candidates:
        if path.is_file():
            return path.resolve()
    return None


@lru_cache(maxsize=4)
def _probe_tensorflow(python_exe: str) -> bool:
    try:
        proc = subprocess.run(
            [python_exe, "-c", "import tensorflow as tf; print(tf.__version__)"],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(INFERENCE_ROOT),
            env={**os.environ, "TF_CPP_MIN_LOG_LEVEL": "3", "TF_ENABLE_ONEDNN_OPTS": "0"},
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return proc.returncode == 0 and bool((proc.stdout or "").strip())


def tensorflow_in_process() -> bool:
    try:
        import tensorflow  # noqa: F401

        return True
    except ImportError:
        return False


def tensorflow_runtime_available() -> bool:
    if tensorflow_in_process():
        return True
    py = resolve_tensorflow_python()
    if py is None:
        return False
    return _probe_tensorflow(str(py))


def tensorflow_runtime_hint() -> str:
    py = resolve_tensorflow_python()
    if py is not None and _probe_tensorflow(str(py)):
        return f"TensorFlow ready via {py}"
    if py is not None:
        return (
            f"Found {py} but TensorFlow is missing there. "
            f"Install with: {py} -m pip install -r requirements-tensorflow.txt"
        )
    return (
        "Create services/inference/.venv-tf with Python 3.10–3.12, then: "
        "pip install -r requirements-tensorflow.txt "
        "(or set TENSORFLOW_PYTHON to that interpreter)."
    )


def _tf_env() -> dict[str, str]:
    return {
        **os.environ,
        "PYTHONPATH": str(INFERENCE_ROOT)
        + (os.pathsep + os.environ["PYTHONPATH"] if os.environ.get("PYTHONPATH") else ""),
        "TF_CPP_MIN_LOG_LEVEL": "2",
        "TF_ENABLE_ONEDNN_OPTS": "0",
    }


def _humanize_worker_failure(detail: str, *, code: int | None = None) -> str:
    text = (detail or "").strip()
    lowered = text.lower()
    if (
        "keyboardinterrupt" in lowered
        or "cancelled" in lowered
        or code in {130, -2, 3221225786}  # SIGINT-ish / Windows Ctrl+C
    ):
        return (
            "Training was cancelled or interrupted "
            "(uvicorn --reload, Force remove, or Ctrl+C). Start the job again."
        )
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) > 8:
        return lines[-1][:500]
    return text[:800] or "unknown error"


def _terminate_process(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
    except OSError:
        pass


def _run_ndjson_worker(python_exe: Path, module: str, payload: dict) -> dict:
    proc = subprocess.Popen(
        [str(python_exe), "-m", module],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        cwd=str(INFERENCE_ROOT),
        env=_tf_env(),
        bufsize=1,
    )
    assert proc.stdin is not None and proc.stdout is not None
    try:
        proc.stdin.write(json.dumps(payload) + "\n")
        proc.stdin.close()

        done: dict | None = None
        errors: list[str] = []
        logs: list[str] = []
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                logs.append(line)
                continue
            kind = event.get("type")
            if kind == "done":
                done = event
            elif kind == "error":
                errors.append(str(event.get("message") or "worker failed"))

        code = proc.wait(timeout=300)
    except BaseException:
        _terminate_process(proc)
        raise
    extra = "\n".join(logs[-20:])
    if code != 0 or errors:
        detail = _humanize_worker_failure(errors[0] if errors else extra or f"exit {code}", code=code)
        raise RuntimeError(f"TensorFlow worker ({module}) failed: {detail}")
    if done is None:
        raise RuntimeError(f"TensorFlow worker ({module}) finished without a done event.\n{extra}")
    return done


def predict_mask_with_runtime(
    rgb: np.ndarray,
    *,
    weights_path: Path,
    imgsz: int = 512,
) -> np.ndarray:
    """Run Keras .h5 mask predict in-process or via .venv-tf."""
    if tensorflow_in_process():
        return _predict_mask_in_process(rgb, Path(weights_path), imgsz)

    py = resolve_tensorflow_python()
    if py is None or not _probe_tensorflow(str(py)):
        raise RuntimeError("floorData inference needs TensorFlow. " + tensorflow_runtime_hint())

    with tempfile.TemporaryDirectory(prefix="highlife-tf-infer-") as tmp:
        tmp_path = Path(tmp)
        image_path = tmp_path / "input.png"
        mask_path = tmp_path / "mask.npy"
        Image.fromarray(np.ascontiguousarray(rgb)).convert("RGB").save(image_path, format="PNG")
        logger.info("floorData infer via TensorFlow venv: %s", py)
        done = _run_ndjson_worker(
            py,
            "app.studio.floordata_infer_worker",
            {
                "image_path": str(image_path),
                "weights_path": str(weights_path),
                "mask_path": str(mask_path),
                "imgsz": int(imgsz),
            },
        )
        out = Path(str(done.get("mask_path") or mask_path))
        if not out.is_file():
            raise FileNotFoundError(f"TF infer worker did not write mask: {out}")
        return np.load(str(out))


def _predict_mask_in_process(rgb: np.ndarray, weights_path: Path, imgsz: int) -> np.ndarray:
    import tensorflow as tf

    from app.yolo.letterbox import letterbox_rgb, unletterbox_mask

    model = tf.keras.models.load_model(str(weights_path), compile=False)
    size = max(32, int(imgsz))
    if size >= 64:
        size = max(64, (size // 32) * 32)
    canvas, scale, ox, oy, orig_hw = letterbox_rgb(rgb, size, fill=255, center=True)
    array = canvas.astype(np.float32) / 255.0
    shape = getattr(model, "input_shape", None)
    channels = 3
    if shape is not None and len(shape) >= 4 and shape[-1] is not None:
        channels = int(shape[-1])
    if channels == 1:
        batch = np.expand_dims(np.mean(array, axis=-1, keepdims=True), axis=0)
    else:
        batch = np.expand_dims(array, axis=0)
    pred = model.predict(batch, verbose=0)
    if isinstance(pred, (list, tuple)):
        pred = pred[0]
    mask = np.asarray(pred)
    if mask.ndim == 4:
        mask = mask[0]
    if mask.ndim == 2 and (mask.shape[0] != size or mask.shape[1] != size):
        mask = np.asarray(
            Image.fromarray(mask.astype(np.float32), mode="F").resize((size, size), Image.BILINEAR),
            dtype=np.float32,
        )
    elif mask.ndim == 3 and (mask.shape[0] != size or mask.shape[1] != size):
        ch = mask.shape[-1]
        resized = np.zeros((size, size, ch), dtype=np.float32)
        for c in range(ch):
            resized[..., c] = np.asarray(
                Image.fromarray(mask[..., c].astype(np.float32), mode="F").resize(
                    (size, size), Image.BILINEAR
                ),
                dtype=np.float32,
            )
        mask = resized
    return unletterbox_mask(
        mask,
        scale=scale,
        offset_x=ox,
        offset_y=oy,
        orig_hw=orig_hw,
        canvas_size=size,
    )


def train_floordata_with_runtime(
    *,
    kind: str,
    data_yaml: Path,
    weights_out: Path,
    pretrained_path: Path | None,
    class_names: list[str],
    epochs: int,
    imgsz: int,
    batch: int,
    device: str,
    project: Path,
    name: str,
    on_epoch=None,
    preview_path: Path | None = None,
) -> Path:
    """Train in-process when TF is importable; otherwise use .venv-tf via subprocess."""
    if tensorflow_in_process():
        from app.studio.floordata_train import train_floordata

        return train_floordata(
            kind=kind,
            data_yaml=data_yaml,
            weights_out=weights_out,
            pretrained_path=pretrained_path,
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

    py = resolve_tensorflow_python()
    if py is None or not _probe_tensorflow(str(py)):
        raise RuntimeError(
            "floorData fine-tuning needs TensorFlow. " + tensorflow_runtime_hint()
        )

    return _train_floordata_subprocess(
        python_exe=py,
        kind=kind,
        data_yaml=data_yaml,
        weights_out=weights_out,
        pretrained_path=pretrained_path,
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


def _train_floordata_subprocess(
    *,
    python_exe: Path,
    kind: str,
    data_yaml: Path,
    weights_out: Path,
    pretrained_path: Path | None,
    class_names: list[str],
    epochs: int,
    imgsz: int,
    batch: int,
    device: str,
    project: Path,
    name: str,
    on_epoch=None,
    preview_path: Path | None = None,
) -> Path:
    payload = {
        "kind": kind,
        "data_yaml": str(data_yaml),
        "weights_out": str(weights_out),
        "pretrained_path": str(pretrained_path) if pretrained_path else "",
        "class_names": list(class_names),
        "epochs": int(epochs),
        "imgsz": int(imgsz),
        "batch": int(batch),
        "device": device,
        "project": str(project),
        "name": name,
        "preview_path": str(preview_path) if preview_path else "",
    }
    logger.info("Starting floorData train in TensorFlow venv: %s", python_exe)
    proc = subprocess.Popen(
        [str(python_exe), "-m", "app.studio.floordata_worker"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        cwd=str(INFERENCE_ROOT),
        env=_tf_env(),
        bufsize=1,
    )
    assert proc.stdin is not None and proc.stdout is not None
    try:
        proc.stdin.write(json.dumps(payload) + "\n")
        proc.stdin.close()

        final_path: Path | None = None
        errors: list[str] = []
        logs: list[str] = []
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                logs.append(line)
                logger.debug("floorData worker log: %s", line[:300])
                continue
            kind_evt = event.get("type")
            if kind_evt == "epoch" and on_epoch is not None:
                on_epoch(
                    int(event.get("current") or 0),
                    int(event.get("total") or epochs),
                    metrics=dict(event.get("metrics") or {}),
                    last_weights=Path(event["last_weights"]) if event.get("last_weights") else None,
                    sample=Path(event["sample"]) if event.get("sample") else None,
                    preview_ok=bool(event.get("preview_ok")),
                )
            elif kind_evt == "done":
                final_path = Path(str(event.get("weights_out") or weights_out))
            elif kind_evt == "error":
                errors.append(str(event.get("message") or "floorData worker failed"))

        code = proc.wait(timeout=60)
    except BaseException:
        _terminate_process(proc)
        raise

    extra = "\n".join(logs[-20:])
    if code != 0 or errors:
        detail = _humanize_worker_failure(errors[0] if errors else extra or f"exit {code}", code=code)
        raise RuntimeError(f"floorData TensorFlow worker failed: {detail}")
    if final_path is None or not final_path.is_file():
        raise FileNotFoundError(
            f"floorData worker finished without weights at {weights_out}"
            + (f"\n{extra}" if extra else "")
        )
    return final_path
