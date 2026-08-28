"""Overlapping-tile inference for large floor-plan rasters."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

import numpy as np

from app.yolo.predict import DetectedRegion
from app.yolo.tile_merge import merge_tiled_regions

ProgressFn = Callable[[str, dict[str, Any]], None]
CancelFn = Callable[[], bool]


class DetectCancelled(Exception):
    """Raised when the client aborts mid-tiling."""


@dataclass(frozen=True)
class TileWindow:
    x0: int
    y0: int
    x1: int
    y1: int

    @property
    def width(self) -> int:
        return self.x1 - self.x0

    @property
    def height(self) -> int:
        return self.y1 - self.y0

    def as_dict(self) -> dict[str, int]:
        return {"x": self.x0, "y": self.y0, "width": self.width, "height": self.height}


def should_tile(height: int, width: int, *, tile_size: int, min_side: int) -> bool:
    if tile_size <= 0:
        return False
    return max(int(height), int(width)) > max(int(min_side), int(tile_size))


def iter_tiles(
    height: int,
    width: int,
    tile_size: int,
    overlap: float = 0.2,
) -> list[TileWindow]:
    """Axis-aligned overlapping windows covering the image."""
    if height <= 0 or width <= 0:
        return []
    size = max(32, int(tile_size))
    if max(height, width) <= size:
        return [TileWindow(0, 0, width, height)]

    overlap = float(np.clip(overlap, 0.0, 0.8))
    stride = max(1, int(round(size * (1.0 - overlap))))
    tiles: list[TileWindow] = []
    y = 0
    while True:
        y1 = min(height, y + size)
        y0 = max(0, y1 - size) if y1 == height and y1 - y < size else y
        x = 0
        while True:
            x1 = min(width, x + size)
            x0 = max(0, x1 - size) if x1 == width and x1 - x < size else x
            tiles.append(TileWindow(x0, y0, x1, y1))
            if x1 >= width:
                break
            x += stride
        if y1 >= height:
            break
        y += stride
    return tiles


def extract_tile_rgb(
    rgb: np.ndarray,
    tile: TileWindow,
    *,
    pad_to: int | None = None,
    pad_value: int = 255,
) -> np.ndarray:
    crop = rgb[tile.y0 : tile.y1, tile.x0 : tile.x1]
    if not pad_to or (crop.shape[0] >= pad_to and crop.shape[1] >= pad_to):
        return np.ascontiguousarray(crop)
    canvas = np.full((pad_to, pad_to, rgb.shape[2]), pad_value, dtype=rgb.dtype)
    canvas[: crop.shape[0], : crop.shape[1]] = crop
    return canvas


def offset_region(region: DetectedRegion, dx: float, dy: float) -> DetectedRegion:
    polygon = [(float(x) + dx, float(y) + dy) for x, y in region.polygon]
    x, y, w, h = region.bbox
    return DetectedRegion(
        id=str(uuid4()),
        type=region.type,
        label=region.label,
        confidence=region.confidence,
        polygon=polygon,
        bbox=(float(x) + dx, float(y) + dy, float(w), float(h)),
        attributes=dict(region.attributes or {}),
    )


def _bbox_iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ax2, ay2 = ax + aw, ay + ah
    bx2, by2 = bx + bw, by + bh
    ix1, iy1 = max(ax, bx), max(ay, by)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    union = aw * ah + bw * bh - inter
    return float(inter / union) if union > 0 else 0.0


def nms_regions(
    regions: list[DetectedRegion],
    *,
    iou_threshold: float = 0.45,
) -> list[DetectedRegion]:
    """Greedy NMS per (type, label), keeping higher confidence.

    Prefer ``merge_tiled_regions`` after tiled infer — NMS *drops* overlapping
    mask fragments instead of unioning them.
    """
    if len(regions) <= 1:
        return regions
    kept: list[DetectedRegion] = []
    by_key: dict[tuple[str, str], list[DetectedRegion]] = {}
    for region in regions:
        key = (str(region.type), str(region.label))
        by_key.setdefault(key, []).append(region)

    for group in by_key.values():
        ordered = sorted(group, key=lambda r: float(r.confidence), reverse=True)
        selected: list[DetectedRegion] = []
        for candidate in ordered:
            if any(_bbox_iou(candidate.bbox, other.bbox) >= iou_threshold for other in selected):
                continue
            selected.append(candidate)
        kept.extend(selected)
    kept.sort(key=lambda r: float(r.confidence), reverse=True)
    return kept


def stitch_wall_regions(
    regions: list[DetectedRegion],
    *,
    iou_soft: float = 0.45,
) -> list[DetectedRegion]:
    """Tiled NMM + polygon union for every class. Name kept for mask backends."""
    return merge_tiled_regions(regions, iou_threshold=iou_soft)


def map_progress_coords(
    on_progress: ProgressFn | None,
    *,
    dx: float = 0.0,
    dy: float = 0.0,
    sx: float = 1.0,
    sy: float = 1.0,
) -> ProgressFn | None:
    """Offset/scale tile rects (and region geometry) before forwarding progress."""
    if on_progress is None:
        return None

    def emit(kind: str, data: dict[str, Any]) -> None:
        out = dict(data)
        tile = out.get("tile")
        if isinstance(tile, dict):
            out["tile"] = {
                "x": (float(tile.get("x", 0)) + dx) * sx,
                "y": (float(tile.get("y", 0)) + dy) * sy,
                "width": float(tile.get("width", 0)) * sx,
                "height": float(tile.get("height", 0)) * sy,
            }
        if "width" in out and "height" in out and kind == "meta":
            out["width"] = float(out["width"]) * sx
            out["height"] = float(out["height"]) * sy
        regions = out.get("regions")
        if isinstance(regions, list) and regions and hasattr(regions[0], "bbox"):
            from app.yolo.predict import _scale_region_to_original

            scaled: list[DetectedRegion] = []
            for region in regions:
                # Always clone before offset/scale so stream progress never mutates
                # the collected tile list (final path scales those once).
                shifted = offset_region(region, dx, dy)
                if abs(sx - 1.0) > 1e-6 or abs(sy - 1.0) > 1e-6:
                    scaled.append(_scale_region_to_original(shifted, sx, sy))
                else:
                    scaled.append(shifted)
            out["regions"] = scaled
        on_progress(kind, out)

    return emit


def run_tiled_detect(
    rgb: np.ndarray,
    *,
    predict_fn: Callable[[np.ndarray], list[DetectedRegion]],
    tile_size: int,
    overlap: float = 0.2,
    min_side: int = 1280,
    iou_threshold: float = 0.45,
    pad_tiles: bool = True,
    on_progress: ProgressFn | None = None,
    cancel_check: CancelFn | None = None,
) -> list[DetectedRegion]:
    """
    Run ``predict_fn`` on overlapping tiles when the image is large.

    ``predict_fn`` receives a tile RGB crop and must return regions in that
    crop's local pixel coordinates. After all tiles, overlapping same-class
    instances are unioned (NMM), not suppressed.

    Progress events (optional):
      meta → {tiled, tileCount, tileSize, width, height}
      tile_start → {index, total, tile}
      tile_done → {index, total, tile, regionCount, regions}
    """
    height, width = rgb.shape[:2]
    size = max(32, int(tile_size))

    def _check_cancel() -> None:
        if cancel_check and cancel_check():
            raise DetectCancelled()

    if not should_tile(height, width, tile_size=size, min_side=min_side):
        if on_progress:
            on_progress(
                "meta",
                {
                    "tiled": False,
                    "tileCount": 1,
                    "tileSize": size,
                    "width": width,
                    "height": height,
                },
            )
            on_progress(
                "tile_start",
                {
                    "index": 1,
                    "total": 1,
                    "tile": {"x": 0, "y": 0, "width": width, "height": height},
                },
            )
        _check_cancel()
        regions = predict_fn(rgb) or []
        if on_progress:
            on_progress(
                "tile_done",
                {
                    "index": 1,
                    "total": 1,
                    "tile": {"x": 0, "y": 0, "width": width, "height": height},
                    "regionCount": len(regions),
                    "regions": regions,
                },
            )
        return regions

    tiles = iter_tiles(height, width, size, overlap)
    total = len(tiles)
    if on_progress:
        on_progress(
            "meta",
            {
                "tiled": True,
                "tileCount": total,
                "tileSize": size,
                "width": width,
                "height": height,
            },
        )

    collected: list[DetectedRegion] = []
    for index, tile in enumerate(tiles, start=1):
        _check_cancel()
        if on_progress:
            on_progress(
                "tile_start",
                {"index": index, "total": total, "tile": tile.as_dict()},
            )
        crop = extract_tile_rgb(rgb, tile, pad_to=size if pad_tiles else None)
        regions = predict_fn(crop) or []
        kept_here: list[DetectedRegion] = []
        for region in regions:
            # Ignore detections that fall only in the padded margin.
            x, y, w, h = region.bbox
            if x >= tile.width or y >= tile.height:
                continue
            clipped_w = min(float(w), float(tile.width) - float(x))
            clipped_h = min(float(h), float(tile.height) - float(y))
            if clipped_w <= 1 or clipped_h <= 1:
                continue
            shifted = offset_region(region, float(tile.x0), float(tile.y0))
            shifted.attributes["tile"] = tile.as_dict()
            kept_here.append(shifted)
            collected.append(shifted)
        if on_progress:
            on_progress(
                "tile_done",
                {
                    "index": index,
                    "total": total,
                    "tile": tile.as_dict(),
                    "regionCount": len(kept_here),
                    "regions": kept_here,
                },
            )
    if on_progress and collected:
        on_progress(
            "status",
            {"message": "Merging overlapping detections…"},
        )
    return merge_tiled_regions(collected, iou_threshold=iou_threshold)


def _detect_single_pass(
    rgb: np.ndarray,
    *,
    predict_fn: Callable[[np.ndarray], list[DetectedRegion]],
    tile_size: int,
    on_progress: ProgressFn | None = None,
    cancel_check: CancelFn | None = None,
) -> list[DetectedRegion]:
    height, width = rgb.shape[:2]
    if on_progress:
        on_progress(
            "meta",
            {
                "tiled": False,
                "tileCount": 1,
                "tileSize": int(tile_size),
                "width": width,
                "height": height,
            },
        )
        on_progress(
            "tile_start",
            {
                "index": 1,
                "total": 1,
                "tile": {"x": 0, "y": 0, "width": width, "height": height},
            },
        )
    if cancel_check and cancel_check():
        raise DetectCancelled()
    regions = predict_fn(rgb) or []
    if on_progress:
        on_progress(
            "tile_done",
            {
                "index": 1,
                "total": 1,
                "tile": {"x": 0, "y": 0, "width": width, "height": height},
                "regionCount": len(regions),
                "regions": regions,
            },
        )
    return regions


def detect_on_crop(
    rgb: np.ndarray,
    *,
    settings,
    predict_fn: Callable[[np.ndarray], list[DetectedRegion]],
    tile_size: int | None = None,
    pad_tiles: bool = True,
    on_progress: ProgressFn | None = None,
    cancel_check: CancelFn | None = None,
    use_tiling: bool = True,
) -> list[DetectedRegion]:
    """Run detection on a crop; tile only when ``use_tiling`` is true."""
    size = int(tile_size or getattr(settings, "detect_tile_size", 640) or 640)
    if not use_tiling or not bool(getattr(settings, "detect_tile_enabled", True)):
        return _detect_single_pass(
            rgb,
            predict_fn=predict_fn,
            tile_size=size,
            on_progress=on_progress,
            cancel_check=cancel_check,
        )
    # Inside a drawing-area crop, tile when the crop exceeds model input size (imgsz).
    min_side = size
    return maybe_tiled_detect(
        rgb,
        settings=settings,
        predict_fn=predict_fn,
        tile_size=size,
        min_side=min_side,
        pad_tiles=pad_tiles,
        on_progress=on_progress,
        cancel_check=cancel_check,
    )


def maybe_tiled_detect(
    rgb: np.ndarray,
    *,
    settings,
    predict_fn: Callable[[np.ndarray], list[DetectedRegion]],
    tile_size: int | None = None,
    min_side: int | None = None,
    pad_tiles: bool = True,
    on_progress: ProgressFn | None = None,
    cancel_check: CancelFn | None = None,
) -> list[DetectedRegion]:
    """Apply tiling when enabled in settings; otherwise call ``predict_fn`` once."""
    if not bool(getattr(settings, "detect_tile_enabled", True)):
        height, width = rgb.shape[:2]
        if on_progress:
            on_progress(
                "meta",
                {
                    "tiled": False,
                    "tileCount": 1,
                    "tileSize": int(tile_size or getattr(settings, "detect_tile_size", 640) or 640),
                    "width": width,
                    "height": height,
                },
            )
            on_progress(
                "tile_start",
                {
                    "index": 1,
                    "total": 1,
                    "tile": {"x": 0, "y": 0, "width": width, "height": height},
                },
            )
        if cancel_check and cancel_check():
            raise DetectCancelled()
        regions = predict_fn(rgb) or []
        if on_progress:
            on_progress(
                "tile_done",
                {
                    "index": 1,
                    "total": 1,
                    "tile": {"x": 0, "y": 0, "width": width, "height": height},
                    "regionCount": len(regions),
                    "regions": regions,
                },
            )
        return regions
    size = int(tile_size or getattr(settings, "detect_tile_size", 640) or 640)
    gate = int(
        min_side
        if min_side is not None
        else getattr(settings, "detect_tile_min_side", 1280) or 1280
    )
    return run_tiled_detect(
        rgb,
        predict_fn=predict_fn,
        tile_size=size,
        overlap=float(getattr(settings, "detect_tile_overlap", 0.2) or 0.2),
        min_side=gate,
        iou_threshold=float(getattr(settings, "detect_tile_iou", 0.45) or 0.45),
        pad_tiles=pad_tiles,
        on_progress=on_progress,
        cancel_check=cancel_check,
    )
