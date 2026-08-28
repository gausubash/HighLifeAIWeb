"""floorData DeepLabV3+ / UNet wall segmentation (TensorFlow .h5).

Source: https://github.com/Divak-ar/floorData

Weights are not published with the repo — place trained checkpoints under models/:

- ``deeplab_walls_best.h5``  (DeepLabV3+)
- ``unet_walls_best.h5`` or ``simple_walls_best.h5``  (UNet notebook)

Inference/training use the main process when TensorFlow imports there; otherwise
``services/inference/.venv-tf`` (see ``app.studio.tf_runtime``).
"""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import numpy as np

from app.config import Settings, get_settings
from app.yolo.mitunet import mask_to_polygons
from app.yolo.predict import DetectedRegion
from app.yolo.wall_registry import (
    FLOORDATA_WALL_BACKENDS,
    resolve_legacy_wall_weights_for_backend,
)

FLOORDATA_MODEL_IDS = {
    "deeplab": "floordata-deeplabv3plus",
    "floordata": "floordata-deeplabv3plus",
    "unet_floordata": "floordata-unet",
}


def tensorflow_available() -> bool:
    """True if TF imports here or the dedicated .venv-tf runtime is ready."""
    try:
        from app.studio.tf_runtime import tensorflow_runtime_available

        return tensorflow_runtime_available()
    except Exception:
        try:
            import tensorflow  # noqa: F401

            return True
        except ImportError:
            return False


def floordata_ready(settings: Settings | None = None, backend: str | None = None) -> bool:
    settings = settings or get_settings()
    name = (backend or settings.wall_backend or "").strip().lower()
    if name not in FLOORDATA_WALL_BACKENDS:
        return False
    if not tensorflow_available():
        return False
    path = resolve_legacy_wall_weights_for_backend(settings, name)
    return bool(path) and Path(path).is_file()


def _weights_path(settings: Settings, backend: str) -> Path:
    path = Path(resolve_legacy_wall_weights_for_backend(settings, backend))
    if not path.is_file():
        raise FileNotFoundError(
            f"floorData weights missing: {path}. Train or copy the .h5 from "
            "https://github.com/Divak-ar/floorData into services/inference/models/."
        )
    return path


def predict_wall_mask(
    rgb: np.ndarray,
    *,
    settings: Settings | None = None,
    backend: str | None = None,
) -> np.ndarray:
    """Return float mask in original crop space, values in [0, 1]."""
    from app.studio.tf_runtime import predict_mask_with_runtime, tensorflow_runtime_hint

    settings = settings or get_settings()
    name = (backend or settings.wall_backend or "").strip().lower()
    if name not in FLOORDATA_WALL_BACKENDS:
        raise ValueError(f"Not a floorData backend: {name}")
    if not tensorflow_available():
        raise RuntimeError("floorData backends need TensorFlow. " + tensorflow_runtime_hint())

    weights = _weights_path(settings, name)
    mask = predict_mask_with_runtime(rgb, weights_path=weights, imgsz=settings.floordata_imgsz)
    if mask.ndim == 3:
        # (H, W, C) — take first / wall channel
        mask = mask[..., 0] if mask.shape[-1] <= 2 else np.max(mask, axis=-1)
    return np.clip(mask.astype(np.float32), 0.0, 1.0)


def wall_polygons_from_rgb(
    rgb: np.ndarray,
    *,
    settings: Settings | None = None,
    backend: str | None = None,
) -> tuple[list[list[tuple[float, float]]], float]:
    settings = settings or get_settings()
    probs = predict_wall_mask(rgb, settings=settings, backend=backend)
    threshold = float(settings.floordata_threshold)
    binary = probs >= threshold
    if not np.any(binary):
        return [], 0.0
    confidence = float(probs[binary].mean())
    polygons = mask_to_polygons(binary.astype(np.uint8))
    out = [[(float(x), float(y)) for x, y in poly] for poly in polygons]
    return out, confidence


def detect_floordata_walls(
    rgb: np.ndarray,
    *,
    settings: Settings | None = None,
    backend: str | None = None,
) -> list[DetectedRegion]:
    settings = settings or get_settings()
    name = (backend or settings.wall_backend or "").strip().lower()
    polygons, confidence = wall_polygons_from_rgb(rgb, settings=settings, backend=name)
    source = FLOORDATA_MODEL_IDS.get(name, name)
    regions: list[DetectedRegion] = []
    for polygon in polygons:
        if len(polygon) < 3:
            continue
        xs = [p[0] for p in polygon]
        ys = [p[1] for p in polygon]
        x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
        regions.append(
            DetectedRegion(
                id=str(uuid4()),
                type="wall",
                label="Wall",
                confidence=round(confidence, 4),
                polygon=polygon,
                bbox=(x0, y0, x1 - x0, y1 - y0),
                attributes={
                    "roomType": "wall",
                    "label": "Wall",
                    "source": source,
                },
            )
        )
    return regions
