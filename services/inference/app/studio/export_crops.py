"""Crop labelled regions from Studio pages for specialist fine-tune datasets."""

from __future__ import annotations

import math
from typing import Any

from app.studio.layout_crop import _norm_label


def norm_label(label: str) -> str:
    return _norm_label(label)


def shape_bbox(
    points: list,
    *,
    min_extent: float = 2.0,
    point_pad: float = 8.0,
) -> tuple[float, float, float, float] | None:
    """Axis-aligned bbox from LabelMe points. Tiny / point shapes get a small pad."""
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
    if x1 - x0 < min_extent and y1 - y0 < min_extent:
        cx = (x0 + x1) / 2
        cy = (y0 + y1) / 2
        return cx - point_pad, cy - point_pad, cx + point_pad, cy + point_pad
    return x0, y0, x1, y1


def padded_crop_xyxy(
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    *,
    image_w: int,
    image_h: int,
    padding_frac: float = 0.25,
    min_side: int = 64,
    square: bool = True,
) -> tuple[int, int, int, int]:
    """Expand a bbox with padding (and optional square), then clamp to the image."""
    if image_w < 2 or image_h < 2:
        return 0, 0, max(1, image_w), max(1, image_h)
    if x1 < x0:
        x0, x1 = x1, x0
    if y1 < y0:
        y0, y1 = y1, y0
    w = max(1.0, x1 - x0)
    h = max(1.0, y1 - y0)
    pad = max(0.0, float(padding_frac)) * max(w, h)
    x0 -= pad
    y0 -= pad
    x1 += pad
    y1 += pad
    side = max(x1 - x0, y1 - y0, float(min_side))
    if square:
        cx = (x0 + x1) / 2
        cy = (y0 + y1) / 2
        x0 = cx - side / 2
        y0 = cy - side / 2
        x1 = cx + side / 2
        y1 = cy + side / 2
    elif min(x1 - x0, y1 - y0) < min_side:
        if x1 - x0 < min_side:
            extra = (min_side - (x1 - x0)) / 2
            x0 -= extra
            x1 += extra
        if y1 - y0 < min_side:
            extra = (min_side - (y1 - y0)) / 2
            y0 -= extra
            y1 += extra

    ix0 = int(math.floor(x0))
    iy0 = int(math.floor(y0))
    ix1 = int(math.ceil(x1))
    iy1 = int(math.ceil(y1))
    ix0 = max(0, min(image_w - 1, ix0))
    iy0 = max(0, min(image_h - 1, iy0))
    ix1 = max(ix0 + 1, min(image_w, ix1))
    iy1 = max(iy0 + 1, min(image_h, iy1))
    return ix0, iy0, ix1, iy1


def remap_shape_to_crop(
    shape: dict[str, Any],
    *,
    x0: int,
    y0: int,
    crop_w: int,
    crop_h: int,
) -> dict[str, Any] | None:
    points = shape.get("points") or []
    if not isinstance(points, list):
        return None
    local: list[list[float]] = []
    for pt in points:
        if not isinstance(pt, (list, tuple)) or len(pt) < 2:
            continue
        try:
            lx = min(float(crop_w), max(0.0, float(pt[0]) - x0))
            ly = min(float(crop_h), max(0.0, float(pt[1]) - y0))
        except (TypeError, ValueError):
            continue
        local.append([lx, ly])
    if len(local) < 1:
        return None
    cloned = dict(shape)
    cloned["points"] = local
    return cloned


def infer_crop_dataset_meta(
    class_labels: list[str],
    source_category: str | None,
    source_task: str | None,
) -> tuple[str | None, str]:
    """Pick a Studio category/task for the cropped dataset from exported class names."""
    from app.studio.model_catalog import DATASET_CATEGORY_DEFAULTS, normalize_category

    wanted = {norm_label(name) for name in class_labels if str(name).strip()}
    if wanted:
        for cat, defaults in DATASET_CATEGORY_DEFAULTS.items():
            cat_labels = {norm_label(str(name)) for name in (defaults.get("class_names") or [])}
            if wanted <= cat_labels:
                return cat, str(defaults.get("task") or "detect")
    cat = normalize_category(source_category)
    if cat and cat in DATASET_CATEGORY_DEFAULTS:
        return cat, str(DATASET_CATEGORY_DEFAULTS[cat].get("task") or source_task or "detect")
    task = source_task if source_task in {"detect", "segment", "pose"} else "detect"
    return None, task
