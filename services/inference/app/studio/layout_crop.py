"""Resolve the main drawing crop for Studio tile generation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
from PIL import Image

from app.yolo.crop import clamp_crop_xyxy, is_drawing_area, select_drawing_areas

# LabelMe / layout region names that denote the main floor plan crop.
_DRAWING_LABELS = frozenset(
    {
        "drawing area",
        "drawing zone",
        "main drawing",
        "main drawing zone",
        "main floorplan",
        "main floor plan",
        "floor plan",
        "floor plan image",
        "floorplan",
    }
)


@dataclass(frozen=True)
class _ShapeRegion:
    type: str
    label: str
    attributes: dict[str, object]


def _norm_label(label: str) -> str:
    return " ".join((label or "").strip().lower().replace("_", " ").split())


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


def _shape_is_drawing_area(shape: dict[str, Any]) -> bool:
    label = str(shape.get("label") or "")
    flags = shape.get("flags") or {}
    attrs: dict[str, object] = dict(flags) if isinstance(flags, dict) else {}
    layout_kind = str(attrs.get("layoutKind") or attrs.get("layout_kind") or "").strip().lower()
    if layout_kind == "main_floorplan":
        return True
    region = _ShapeRegion(type=str(shape.get("shape_type") or ""), label=label, attributes=attrs)
    if is_drawing_area(region):
        return True
    return _norm_label(label) in _DRAWING_LABELS


def drawing_bbox_from_labelme_shapes(shapes: list[dict[str, Any]]) -> tuple[float, float, float, float] | None:
    """Largest drawing-area rectangle from LabelMe shapes (Main drawing, Drawing area, …)."""
    best: tuple[float, float, float, float] | None = None
    best_area = 0.0
    for shape in shapes or []:
        if not _shape_is_drawing_area(shape):
            continue
        bbox = _bbox_from_points(list(shape.get("points") or []))
        if not bbox:
            continue
        area = bbox[2] * bbox[3]
        if area > best_area:
            best_area = area
            best = bbox
    return best


def drawing_bbox_from_layout_model(
    rgb: np.ndarray,
    *,
    studio_infer: bool = False,
) -> tuple[float, float, float, float] | None:
    """Run GreenMap layout YOLO on the page and return the best drawing-area bbox."""
    try:
        from app.config import get_settings
        from app.yolo.predict import _predict_regions, get_yolo_model, layout_enabled, yolo_ready
    except ImportError:
        return None

    settings = get_settings()
    if not yolo_ready(settings):
        return None
    if not studio_infer and not layout_enabled(settings):
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
    studio_infer: bool = False,
) -> tuple[int, int, int, int] | None:
    """
    Return pixel crop ``(x0, y0, x1, y1)`` for tiling.

    Prefers a manual drawing-area LabelMe box, then layout-model detection.
    When ``studio_infer`` is true, layout YOLO runs even if USE_LAYOUT_DETECTOR is off
    (as long as weights are available).
    """
    if width < 1 or height < 1:
        return None

    bbox = drawing_bbox_from_labelme_shapes(list(shapes or []))
    if bbox is None and rgb is not None:
        bbox = drawing_bbox_from_layout_model(rgb, studio_infer=studio_infer)
    if bbox is None:
        return None

    return clamp_crop_xyxy(width, height, bbox, pad_frac=pad_frac)


def pil_rgb_from_png(png_bytes: bytes) -> np.ndarray:
    return np.asarray(Image.open(__import__("io").BytesIO(png_bytes)).convert("RGB"), dtype=np.uint8)
