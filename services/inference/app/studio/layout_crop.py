"""Resolve the main drawing crop for Studio tile generation."""

from __future__ import annotations

from typing import Any

import numpy as np
from PIL import Image

from app.yolo.crop import clamp_crop_xyxy, select_drawing_areas

# LabelMe / layout region names that denote the main floor plan crop.
_DRAWING_LABELS = frozenset(
    {
        "drawing area",
        "drawing_area",
        "main floorplan",
        "main_floorplan",
        "floor plan",
        "floorplan",
    }
)


def _norm_label(label: str) -> str:
    return " ".join((label or "").strip().lower().replace("_", "-").replace("-", " ").split())


def _bbox_from_points(points: list) -> tuple[float, float, float, float] | None:
    pairs: list[tuple[float, float]] = []
    for pt in points or []:
        if not isinstance(pt, (list, tuple)) or len(pt) < 2:
            continue
        try:
            pairs.append((float(pt[0]), float(pt[1])))
        except (TypeError, ValueError):
            continue
    if not pairs:
        return None
    xs = [p[0] for p in pairs]
    ys = [p[1] for p in pairs]
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    if x1 - x0 < 8 or y1 - y0 < 8:
        return None
    return x0, y0, x1 - x0, y1 - y0


def drawing_bbox_from_labelme_shapes(shapes: list[dict[str, Any]]) -> tuple[float, float, float, float] | None:
    """Largest ``Drawing area`` / ``main_floorplan`` rectangle from LabelMe shapes."""
    best: tuple[float, float, float, float] | None = None
    best_area = 0.0
    for shape in shapes or []:
        label = _norm_label(str(shape.get("label") or ""))
        if label not in _DRAWING_LABELS:
            continue
        bbox = _bbox_from_points(list(shape.get("points") or []))
        if not bbox:
            continue
        area = bbox[2] * bbox[3]
        if area > best_area:
            best_area = area
            best = bbox
    return best


def drawing_bbox_from_layout_model(rgb: np.ndarray) -> tuple[float, float, float, float] | None:
    """Run GreenMap layout YOLO on the page and return the best drawing-area bbox."""
    try:
        from app.config import get_settings
        from app.yolo.predict import _predict_regions, get_yolo_model, layout_enabled, yolo_ready
    except ImportError:
        return None

    settings = get_settings()
    if not layout_enabled(settings) or not yolo_ready(settings):
        return None

    regions = _predict_regions(
        get_yolo_model(settings),
        rgb,
        imgsz=settings.yolo_imgsz,
        conf=settings.yolo_conf,
        device=settings.device.value,
    )
    drawings = select_drawing_areas(regions)
    if not drawings:
        return None
    x, y, w, h = drawings[0].bbox
    return float(x), float(y), float(w), float(h)


def resolve_drawing_crop_xyxy(
    width: int,
    height: int,
    *,
    shapes: list[dict[str, Any]] | None = None,
    rgb: np.ndarray | None = None,
    pad_frac: float = 0.02,
) -> tuple[int, int, int, int] | None:
    """
    Return pixel crop ``(x0, y0, x1, y1)`` for tiling.

    Prefers a manual ``Drawing area`` LabelMe box, then layout-model detection.
    """
    if width < 1 or height < 1:
        return None

    bbox = drawing_bbox_from_labelme_shapes(list(shapes or []))
    if bbox is None and rgb is not None:
        bbox = drawing_bbox_from_layout_model(rgb)
    if bbox is None:
        return None

    return clamp_crop_xyxy(width, height, bbox, pad_frac=pad_frac)


def pil_rgb_from_png(png_bytes: bytes) -> np.ndarray:
    return np.asarray(Image.open(__import__("io").BytesIO(png_bytes)).convert("RGB"), dtype=np.uint8)
