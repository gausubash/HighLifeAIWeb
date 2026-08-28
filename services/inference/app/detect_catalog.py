"""Catalog of models available for POST /v1/detect."""

from __future__ import annotations

from pathlib import Path

from app.config import Settings, get_settings
from app.yolo.mitunet import mitunet_ready
from app.yolo.predict import room_enabled, wall_yolo_ready, yolo_ready
from app.yolo.roboflow import roboflow_ready
from app.yolo.wall_registry import (
    FLOORDATA_WALL_BACKENDS,
    OPTIONAL_WALL_BACKENDS,
    resolve_legacy_wall_weights_for_backend,
)
from app.studio.local_store import list_models, model_weights_path

BUILTIN_WALL_LABELS: dict[str, tuple[str, str, str]] = {
    "mitunet": ("MitUNet wall masks", "segment", "Mix-Transformer B4 + U-Net (default)"),
    "yolo": ("YOLO wall OBB", "detect", "GreenMap oriented wall boxes"),
    "cascade_swin": ("Cascade R-CNN", "detect", "MMDet Cascade R-CNN R101 (.pth)"),
    "faster_rcnn": ("Faster R-CNN", "detect", "MMDet wall detector (.pth)"),
    "retinanet": ("RetinaNet", "detect", "MMDet wall detector (.pth)"),
    "deeplab": ("floorData DeepLabV3+", "segment", "TensorFlow DeepLabV3+ wall masks (.h5)"),
    "floordata": ("floorData DeepLabV3+", "segment", "Alias for deeplab"),
    "unet_floordata": ("floorData UNet", "segment", "TensorFlow UNet wall masks (.h5)"),
}

# All registered wall backends are wired into /v1/detect when weights (+ TF for floorData) are present.
NOT_RUNNABLE_WALL_BACKENDS: frozenset[str] = frozenset()


def _wall_backend_ready(settings: Settings, backend: str) -> bool:
    backend = backend.strip().lower()
    if backend == "mitunet":
        return mitunet_ready(settings.model_copy(update={"wall_backend": "mitunet"}))
    if backend == "yolo":
        return wall_yolo_ready(settings.model_copy(update={"wall_backend": "yolo"}))
    if backend in OPTIONAL_WALL_BACKENDS:
        path = resolve_legacy_wall_weights_for_backend(settings, backend)
        return bool(path) and Path(path).is_file()
    return False


def _wall_backend_runnable(backend: str) -> bool:
    name = backend.strip().lower()
    if name in NOT_RUNNABLE_WALL_BACKENDS:
        return False
    if name in FLOORDATA_WALL_BACKENDS:
        from app.yolo.floordata import tensorflow_available

        return tensorflow_available()
    return True


def parse_detect_model(value: str | None) -> tuple[str | None, str | None, str | None]:
    """Return (studio_model_id, wall_backend, layout_backend) from a detectModel token."""
    raw = (value or "").strip()
    if not raw:
        return None, None, None
    if raw.startswith("studio:"):
        return raw.removeprefix("studio:").strip() or None, None, None
    if raw.startswith("wall:"):
        return None, raw.removeprefix("wall:").strip() or None, None
    if raw.startswith("layout:"):
        return None, None, raw.removeprefix("layout:").strip() or "greenmap"
    # Bare UUID → studio model
    if len(raw) == 36 and raw.count("-") == 4:
        return raw, None, None
    return None, raw, None


def detect_model_token(*, studio_id: str | None = None, wall_backend: str | None = None) -> str:
    if studio_id:
        return f"studio:{studio_id}"
    if wall_backend:
        return f"wall:{wall_backend}"
    return ""


def list_detect_models(settings: Settings | None = None) -> list[dict[str, object]]:
    settings = settings or get_settings()
    items: list[dict[str, object]] = []

    for backend, (label, task, description) in BUILTIN_WALL_LABELS.items():
        if backend in {"floordata"}:
            continue  # alias; show deeplab only
        ready = _wall_backend_ready(settings, backend)
        runnable = _wall_backend_runnable(backend)
        desc = description
        if backend in FLOORDATA_WALL_BACKENDS and not ready:
            desc = f"{description} — run scripts/bootstrap_floordata_weights.py"
        elif backend in FLOORDATA_WALL_BACKENDS and not runnable:
            from app.studio.tf_runtime import tensorflow_runtime_hint

            desc = f"{description} — {tensorflow_runtime_hint()}"
        items.append(
            {
                "id": detect_model_token(wall_backend=backend),
                "name": label,
                "kind": "builtin",
                "task": task,
                "description": desc,
                "ready": ready,
                "runnable": runnable and ready,
                "active": (settings.wall_backend or "mitunet").strip().lower() == backend,
            }
        )

    if roboflow_ready(settings):
        from app.yolo.roboflow import roboflow_local_ready

        local = roboflow_local_ready(settings)
        items.append(
            {
                "id": "wall:roboflow",
                "name": f"Roboflow {settings.roboflow_model_id}",
                "kind": "builtin",
                "task": "detect",
                "description": (
                    "floorplan-iculh on-device ONNX"
                    if local
                    else "floorplan-iculh via Roboflow API (cloud)"
                ),
                "ready": True,
                "runnable": True,
                "active": (settings.wall_backend or "").strip().lower() == "roboflow",
            }
        )

    if yolo_ready(settings):
        items.append(
            {
                "id": "layout:greenmap",
                "name": "GreenMap layout (title / legend / drawing)",
                "kind": "layout",
                "task": "detect",
                "description": (
                    "YOLO11x blueprint layout: drawing area, legend block, title block "
                    "(yolo11x-blueprint-layout-detector)"
                ),
                "ready": True,
                "runnable": True,
                "active": False,
            }
        )

    if settings.use_layout_detector and yolo_ready(settings):
        items.append(
            {
                "id": "stack:layout",
                "name": "Layout + wall stack",
                "kind": "stack",
                "task": "detect",
                "description": "GreenMap layout crop + configured wall backend",
                "ready": True,
                "runnable": True,
                "active": False,
            }
        )

    if room_enabled(settings):
        items.append(
            {
                "id": "stack:rooms",
                "name": "Wall + fixture stack",
                "kind": "stack",
                "task": "detect",
                "description": "Configured walls plus Architect fixtures",
                "ready": True,
                "runnable": True,
                "active": False,
            }
        )

    for model in list_models():
        model_id = str(model.get("id") or "")
        if not model_id:
            continue
        weights = model_weights_path(model_id)
        ready = weights.is_file()
        items.append(
            {
                "id": detect_model_token(studio_id=model_id),
                "name": str(model.get("name") or model_id),
                "kind": "studio",
                "task": str(model.get("task") or "detect"),
                "description": str(model.get("architecture") or "Fine-tuned on this PC"),
                "ready": ready,
                "runnable": ready,
                "active": bool(model.get("is_active")),
                "class_names": list(model.get("class_names") or []),
            }
        )

    return items


def default_detect_model(settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    for model in list_models():
        if model.get("is_active"):
            model_id = str(model.get("id") or "")
            weights = model_weights_path(model_id)
            if weights.is_file():
                return detect_model_token(studio_id=model_id)

    backend = (settings.wall_backend or "mitunet").strip().lower()
    if _wall_backend_ready(settings, backend) and _wall_backend_runnable(backend):
        return detect_model_token(wall_backend=backend)

    for item in list_detect_models(settings):
        if item.get("runnable"):
            return str(item["id"])

    return detect_model_token(wall_backend="mitunet")
