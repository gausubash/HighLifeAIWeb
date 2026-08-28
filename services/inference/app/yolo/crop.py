"""Page-raster crop helpers.

Layout cropping is optional. When it is off, detectors run on a full-page crop
and coordinates stay in page space.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, TypeVar

import numpy as np

DRAWING_AREA_TYPES = frozenset({"main_floorplan"})
DRAWING_AREA_KEYS = frozenset({"drawing_area", "drawing area"})
MIN_CROP_EDGE = 16

T = TypeVar("T")


@dataclass(frozen=True)
class PageCrop:
    rgb: np.ndarray
    x0: int
    y0: int
    width: int
    height: int
    page_width: int
    page_height: int

    def to_page(self, x: float, y: float) -> tuple[float, float]:
        return (x + self.x0, y + self.y0)


def bbox_area(bbox: tuple[float, float, float, float]) -> float:
    return max(0.0, float(bbox[2])) * max(0.0, float(bbox[3]))


def is_drawing_area(region: object) -> bool:
    entity_type = str(getattr(region, "type", "") or "")
    if entity_type in DRAWING_AREA_TYPES:
        return True
    label = str(getattr(region, "label", "") or "").strip().lower().replace("_", " ")
    attrs = getattr(region, "attributes", None) or {}
    room_type = str(attrs.get("roomType") or "").strip().lower().replace("_", " ")
    return label in DRAWING_AREA_KEYS or room_type in DRAWING_AREA_KEYS


def select_drawing_areas(regions: Iterable[T], *, min_conf: float = 0.0) -> list[T]:
    """Largest-confident drawing areas first (multi-plan sheets can have several)."""
    picked: list[T] = []
    for region in regions:
        conf = float(getattr(region, "confidence", 0.0) or 0.0)
        if conf < min_conf or not is_drawing_area(region):
            continue
        picked.append(region)
    picked.sort(
        key=lambda r: bbox_area(getattr(r, "bbox")) * float(getattr(r, "confidence", 0.0) or 0.0),
        reverse=True,
    )
    return picked


def clamp_crop_xyxy(
    page_w: int,
    page_h: int,
    bbox: tuple[float, float, float, float],
    *,
    pad_frac: float = 0.02,
    min_pad: int = 4,
) -> tuple[int, int, int, int] | None:
    x, y, w, h = (float(v) for v in bbox)
    pad = max(float(min_pad), pad_frac * max(w, h))
    x0 = int(np.floor(x - pad))
    y0 = int(np.floor(y - pad))
    x1 = int(np.ceil(x + w + pad))
    y1 = int(np.ceil(y + h + pad))
    x0 = max(0, x0)
    y0 = max(0, y0)
    x1 = min(int(page_w), x1)
    y1 = min(int(page_h), y1)
    if x1 - x0 < MIN_CROP_EDGE or y1 - y0 < MIN_CROP_EDGE:
        return None
    return x0, y0, x1, y1


def crop_page(
    rgb: np.ndarray,
    bbox: tuple[float, float, float, float],
    *,
    pad_frac: float = 0.02,
    min_pad: int = 4,
) -> PageCrop | None:
    page_h, page_w = rgb.shape[:2]
    box = clamp_crop_xyxy(page_w, page_h, bbox, pad_frac=pad_frac, min_pad=min_pad)
    if box is None:
        return None
    x0, y0, x1, y1 = box
    return PageCrop(
        rgb=np.ascontiguousarray(rgb[y0:y1, x0:x1]),
        x0=x0,
        y0=y0,
        width=x1 - x0,
        height=y1 - y0,
        page_width=page_w,
        page_height=page_h,
    )


def crop_page_normalized(
    rgb: np.ndarray,
    crop: dict[str, float],
    *,
    pad_frac: float = 0.02,
    min_pad: int = 4,
) -> PageCrop | None:
    """Crop using normalized fractions ``{x, y, width, height}`` in 0–1 page space."""
    page_h, page_w = rgb.shape[:2]
    if page_w < 1 or page_h < 1:
        return None
    try:
        x = float(crop["x"])
        y = float(crop["y"])
        w = float(crop["width"])
        h = float(crop["height"])
    except (KeyError, TypeError, ValueError):
        return None
    if w <= 0 or h <= 0:
        return None
    bbox = (x * page_w, y * page_h, w * page_w, h * page_h)
    return crop_page(rgb, bbox, pad_frac=pad_frac, min_pad=min_pad)


def full_page_crop(rgb: np.ndarray) -> PageCrop:
    page_h, page_w = rgb.shape[:2]
    return PageCrop(
        rgb=rgb,
        x0=0,
        y0=0,
        width=page_w,
        height=page_h,
        page_width=page_w,
        page_height=page_h,
    )


def offset_polygon(
    poly: list[tuple[float, float]],
    dx: float,
    dy: float,
) -> list[tuple[float, float]]:
    return [(float(x) + dx, float(y) + dy) for x, y in poly]


def offset_bbox(
    bbox: tuple[float, float, float, float],
    dx: float,
    dy: float,
) -> tuple[float, float, float, float]:
    return (bbox[0] + dx, bbox[1] + dy, bbox[2], bbox[3])


def scale_polygon(
    poly: list[tuple[float, float]],
    sx: float,
    sy: float,
) -> list[tuple[float, float]]:
    return [(float(x) * sx, float(y) * sy) for x, y in poly]


def scale_bbox(
    bbox: tuple[float, float, float, float],
    sx: float,
    sy: float,
) -> tuple[float, float, float, float]:
    x, y, w, h = bbox
    return (x * sx, y * sy, w * sx, h * sy)


def scale_crop_px(crop_px: dict[str, float], sx: float, sy: float) -> dict[str, float]:
    return {
        "x": float(crop_px["x"]) * sx,
        "y": float(crop_px["y"]) * sy,
        "width": float(crop_px["width"]) * sx,
        "height": float(crop_px["height"]) * sy,
    }
