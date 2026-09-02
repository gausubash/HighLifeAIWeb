"""Wall-bounded room extract: units first, then interiors enclosed by walls/openings.

Composes existing MitUNet / YOLO predict helpers. Does not train DeepFloorplan attention.
"""

from __future__ import annotations

from collections import deque
from typing import Any
from uuid import uuid4

import numpy as np
from PIL import Image, ImageDraw

from app.yolo.predict import DetectedRegion

MAX_GRID = 320
GENERIC_LABELS = {"room", "unit", "space", "area"}


def _bbox(pts: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def _area(pts: list[tuple[float, float]]) -> float:
    if len(pts) < 3:
        return 0.0
    total = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        total += x1 * y2 - x2 * y1
    return abs(total) * 0.5


def _raster_polys(
    height: int,
    width: int,
    polygons: list[list[tuple[float, float]]],
    src_w: float,
    src_h: float,
) -> np.ndarray:
    img = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(img)
    sx = (width - 1) / max(src_w, 1)
    sy = (height - 1) / max(src_h, 1)
    for poly in polygons:
        if len(poly) < 2:
            continue
        scaled = [(p[0] * sx, p[1] * sy) for p in poly]
        if len(scaled) >= 3:
            draw.polygon(scaled, fill=1)
        else:
            draw.line(scaled, fill=1, width=2)
    return np.asarray(img, dtype=np.uint8)


def _point_in_poly(px: float, py: float, poly: list[tuple[float, float]]) -> bool:
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / ((yj - yi) or 1e-9) + xi:
            inside = not inside
        j = i
    return inside


def _components(open_mask: np.ndarray) -> list[np.ndarray]:
    h, w = open_mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    nid = 0
    dirs = ((1, 0), (-1, 0), (0, 1), (0, -1))
    min_cells = max(8, int(open_mask.sum() * 0.004))
    out: list[np.ndarray] = []
    for y in range(h):
        for x in range(w):
            if not open_mask[y, x] or labels[y, x]:
                continue
            nid += 1
            q: deque[tuple[int, int]] = deque([(x, y)])
            labels[y, x] = nid
            claimed = 0
            touches = False
            cells: list[tuple[int, int]] = []
            while q:
                cx, cy = q.popleft()
                claimed += 1
                cells.append((cx, cy))
                if cx in (0, w - 1) or cy in (0, h - 1):
                    touches = True
                for dx, dy in dirs:
                    nx, ny = cx + dx, cy + dy
                    if nx < 0 or ny < 0 or nx >= w or ny >= h:
                        continue
                    if not open_mask[ny, nx] or labels[ny, nx]:
                        continue
                    labels[ny, nx] = nid
                    q.append((nx, ny))
            if claimed < min_cells:
                continue
            if touches and claimed / max(int(open_mask.sum()), 1) > 0.55:
                continue
            mask = np.zeros((h, w), dtype=np.uint8)
            for cx, cy in cells:
                mask[cy, cx] = 1
            out.append(mask)
    return out


def _mask_polygon(mask: np.ndarray, src_w: float, src_h: float) -> list[tuple[float, float]]:
    from app.yolo.mitunet import mask_to_polygons

    polys = mask_to_polygons(mask, min_area=8, max_vertices=80)
    if not polys:
        return []
    pts = polys[0]
    gh, gw = mask.shape
    return [(float(x) / max(gw - 1, 1) * src_w, float(y) / max(gh - 1, 1) * src_h) for x, y in pts]


def _vote(mask: np.ndarray, label_map: np.ndarray, names: list[str], fallback: str) -> str:
    counts: dict[str, int] = {}
    ys, xs = np.where(mask > 0)
    for y, x in zip(ys, xs, strict=False):
        idx = int(label_map[y, x])
        if idx <= 0 or idx > len(names):
            continue
        name = names[idx - 1]
        counts[name] = counts.get(name, 0) + 1
    if not counts:
        return fallback
    ranked = sorted(
        counts.items(),
        key=lambda kv: (kv[0].strip().lower() in GENERIC_LABELS, -kv[1]),
    )
    return ranked[0][0] or fallback


def extract_wall_bounded_rooms(
    *,
    width_px: float,
    height_px: float,
    wall_mask: np.ndarray | None = None,
    wall_polygons: list[list[tuple[float, float]]] | None = None,
    unit_polygons: list[dict[str, Any]] | None = None,
    openings: list[dict[str, Any]] | None = None,
    room_regions: list[DetectedRegion] | None = None,
) -> list[DetectedRegion]:
    """Flood-fill interiors per unit clip. `wall_mask` is preferred when present."""
    src_w = max(float(width_px), 1.0)
    src_h = max(float(height_px), 1.0)
    scale = min(MAX_GRID / src_w, MAX_GRID / src_h, 1.0)
    gw = max(8, int(round(src_w * scale)))
    gh = max(8, int(round(src_h * scale)))

    barrier = np.zeros((gh, gw), dtype=np.uint8)
    if wall_mask is not None and wall_mask.size:
        resized = np.asarray(
            Image.fromarray((wall_mask > 0).astype(np.uint8) * 255, mode="L").resize(
                (gw, gh), Image.NEAREST
            )
        )
        barrier = (resized > 0).astype(np.uint8)
    if wall_polygons:
        barrier = np.maximum(barrier, _raster_polys(gh, gw, wall_polygons, src_w, src_h))
    opening_polys = [
        [(float(p["x"]), float(p["y"])) for p in (item.get("points") or []) if "x" in p]
        for item in openings or []
    ]
    opening_polys = [p for p in opening_polys if len(p) >= 2]
    if opening_polys:
        barrier = np.maximum(barrier, _raster_polys(gh, gw, opening_polys, src_w, src_h))

    label_map = np.zeros((gh, gw), dtype=np.int16)
    names: list[str] = []
    for region in room_regions or []:
        if region.type != "room":
            continue
        names.append(region.label)
        poly = list(region.polygon)
        mask = _raster_polys(gh, gw, [poly], src_w, src_h)
        label_map = np.where(mask > 0, len(names), label_map).astype(np.int16)

    units = [
        {
            "id": str(u.get("id") or uuid4()),
            "label": str(u.get("label") or "Unit"),
            "points": [(float(p["x"]), float(p["y"])) for p in (u.get("points") or []) if "x" in p],
        }
        for u in unit_polygons or []
    ]
    units = [u for u in units if len(u["points"]) >= 3]
    clips: list[dict[str, Any]] = units or [
        {
            "id": None,
            "label": None,
            "points": [(0.0, 0.0), (src_w, 0.0), (src_w, src_h), (0.0, src_h)],
        }
    ]

    regions: list[DetectedRegion] = []
    for clip in clips:
        clip_mask = _raster_polys(gh, gw, [clip["points"]], src_w, src_h)
        open_mask = (clip_mask > 0) & (barrier == 0)
        drop_border = clip["id"] is None
        parts = _components(open_mask) if drop_border else _components_keep_border(open_mask)
        fallback = "Room"
        for part in parts:
            poly = _mask_polygon(part, src_w, src_h)
            if len(poly) < 3:
                continue
            label = _vote(part, label_map, names, fallback)
            x0, y0, x1, y1 = _bbox(poly)
            regions.append(
                DetectedRegion(
                    id=f"geo-{uuid4().hex[:10]}",
                    type="room",
                    label=label,
                    confidence=1.0,
                    polygon=poly,
                    bbox=(x0, y0, x1 - x0, y1 - y0),
                    attributes={
                        "extractMethod": "wall_bounded",
                        "unitId": clip["id"],
                        "unitLabel": clip["label"],
                        "isCommon": False,
                        "areaPx2": _area(poly),
                    },
                )
            )

    if units:
        sheet = [(0.0, 0.0), (src_w, 0.0), (src_w, src_h), (0.0, src_h)]
        clip_mask = _raster_polys(gh, gw, [sheet], src_w, src_h)
        unit_mask = _raster_polys(gh, gw, [u["points"] for u in units], src_w, src_h)
        open_mask = (clip_mask > 0) & (unit_mask == 0) & (barrier == 0)
        for part in _components(open_mask):
            poly = _mask_polygon(part, src_w, src_h)
            if len(poly) < 3:
                continue
            cx = sum(p[0] for p in poly) / len(poly)
            cy = sum(p[1] for p in poly) / len(poly)
            if any(_point_in_poly(cx, cy, u["points"]) for u in units):
                continue
            x0, y0, x1, y1 = _bbox(poly)
            regions.append(
                DetectedRegion(
                    id=f"geo-{uuid4().hex[:10]}",
                    type="room",
                    label="Corridor",
                    confidence=1.0,
                    polygon=poly,
                    bbox=(x0, y0, x1 - x0, y1 - y0),
                    attributes={
                        "extractMethod": "wall_bounded",
                        "unitId": None,
                        "unitLabel": None,
                        "isCommon": True,
                        "areaPx2": _area(poly),
                    },
                )
            )
    return regions


def _components_keep_border(open_mask: np.ndarray) -> list[np.ndarray]:
    h, w = open_mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    nid = 0
    dirs = ((1, 0), (-1, 0), (0, 1), (0, -1))
    min_cells = max(8, int(open_mask.sum() * 0.004))
    out: list[np.ndarray] = []
    for y in range(h):
        for x in range(w):
            if not open_mask[y, x] or labels[y, x]:
                continue
            nid += 1
            q: deque[tuple[int, int]] = deque([(x, y)])
            labels[y, x] = nid
            cells: list[tuple[int, int]] = []
            while q:
                cx, cy = q.popleft()
                cells.append((cx, cy))
                for dx, dy in dirs:
                    nx, ny = cx + dx, cy + dy
                    if nx < 0 or ny < 0 or nx >= w or ny >= h:
                        continue
                    if not open_mask[ny, nx] or labels[ny, nx]:
                        continue
                    labels[ny, nx] = nid
                    q.append((nx, ny))
            if len(cells) < min_cells:
                continue
            mask = np.zeros((h, w), dtype=np.uint8)
            for cx, cy in cells:
                mask[cy, cx] = 1
            out.append(mask)
    return out


def extract_from_image(
    image_bytes: bytes,
    *,
    original_width: int | None = None,
    original_height: int | None = None,
    unit_polygons: list[dict[str, Any]] | None = None,
    openings: list[dict[str, Any]] | None = None,
) -> tuple[list[DetectedRegion], int, int, str | None]:
    """Call existing wall/room predict; do not edit those functions."""
    from app.config import get_settings
    from app.yolo.mitunet import mitunet_ready, predict_wall_mask
    from app.yolo.predict import (
        _load_rgb,
        _predict_regions,
        get_room_model,
        room_enabled,
    )

    settings = get_settings()
    rgb = _load_rgb(image_bytes)
    src_h, src_w = rgb.shape[:2]
    width_px = int(original_width or src_w)
    height_px = int(original_height or src_h)
    warning: str | None = None

    wall_mask = None
    wall_polygons: list[list[tuple[float, float]]] = []
    if mitunet_ready(settings):
        probs = predict_wall_mask(rgb, settings)
        wall_mask = probs >= float(settings.mitunet_wall_threshold)
        if original_width and original_height and (src_w != width_px or src_h != height_px):
            wall_mask = np.asarray(
                Image.fromarray(wall_mask.astype(np.uint8) * 255, mode="L").resize(
                    (width_px, height_px), Image.NEAREST
                )
            ) > 0
    else:
        warning = "MitUNet walls are not ready. Geometry used client openings/units only."

    room_regions: list[DetectedRegion] = []
    if room_enabled(settings):
        room_regions = _predict_regions(
            get_room_model(settings),
            rgb,
            imgsz=settings.yolo_room_imgsz,
            conf=settings.yolo_room_conf,
            device=settings.device.value,
        )
        sx = width_px / src_w if src_w else 1.0
        sy = height_px / src_h if src_h else 1.0
        if sx != 1.0 or sy != 1.0:
            scaled: list[DetectedRegion] = []
            for region in room_regions:
                poly = [(x * sx, y * sy) for x, y in region.polygon]
                x, y, w, h = region.bbox
                scaled.append(
                    DetectedRegion(
                        id=region.id,
                        type=region.type,
                        label=region.label,
                        confidence=region.confidence,
                        polygon=poly,
                        bbox=(x * sx, y * sy, w * sx, h * sy),
                        attributes=dict(region.attributes or {}),
                    )
                )
            room_regions = scaled

    regions = extract_wall_bounded_rooms(
        width_px=width_px,
        height_px=height_px,
        wall_mask=wall_mask.astype(np.uint8) if wall_mask is not None else None,
        wall_polygons=wall_polygons,
        unit_polygons=unit_polygons,
        openings=openings,
        room_regions=room_regions,
    )
    return regions, width_px, height_px, warning
