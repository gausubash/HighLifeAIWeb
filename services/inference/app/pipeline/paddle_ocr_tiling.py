"""Overlapping-tile OCR — same windowing as YOLO infer/train, sized to PaddleOCR's 960px default."""

from __future__ import annotations

import math
import re
from collections.abc import Callable
from typing import Any

import numpy as np

from app.config import Settings, get_settings
from app.yolo.tiling import TileWindow, iter_tiles, should_tile

ProgressFn = Callable[[str, dict[str, Any]], None]
CancelFn = Callable[[], bool]


class OcrCancelled(Exception):
    """Raised when the client disconnects mid-OCR."""


def _line_bbox(line: dict[str, Any]) -> tuple[float, float, float, float] | None:
    bbox = line.get("bbox")
    if not isinstance(bbox, list) or len(bbox) < 2:
        return None
    try:
        xs = [float(p[0]) for p in bbox]
        ys = [float(p[1]) for p in bbox]
    except (TypeError, ValueError, IndexError):
        return None
    return min(xs), min(ys), max(xs), max(ys)


def _line_center(line: dict[str, Any]) -> tuple[float, float] | None:
    box = _line_bbox(line)
    if not box:
        return None
    x0, y0, x1, y1 = box
    return (x0 + x1) / 2, (y0 + y1) / 2


def _quad_from_box(box: tuple[float, float, float, float]) -> list[list[float]]:
    x0, y0, x1, y1 = box
    return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]


def _union_box(
    a: tuple[float, float, float, float],
    b: tuple[float, float, float, float],
) -> tuple[float, float, float, float]:
    return min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])


def offset_ocr_line(
    line: dict[str, Any],
    dx: float,
    dy: float,
    *,
    cut_edges: list[str] | None = None,
) -> dict[str, Any]:
    bbox = line.get("bbox")
    out = dict(line)
    if isinstance(bbox, list) and bbox:
        out["bbox"] = [[float(x) + dx, float(y) + dy] for x, y in bbox]
    if cut_edges:
        out["cutEdges"] = list(cut_edges)
    return out


def cut_edges_for_local_line(
    line: dict[str, Any],
    tile: TileWindow,
    image_width: int,
    image_height: int,
    margin: float = 12.0,
) -> list[str]:
    """Edges where this detection likely ran off a tile (not the page border)."""
    box = _line_bbox(line)
    if not box:
        return []
    x0, y0, x1, y1 = box
    edges: list[str] = []
    if x0 <= margin and tile.x0 > 0:
        edges.append("left")
    if (tile.width - x1) <= margin and tile.x1 < image_width:
        edges.append("right")
    if y0 <= margin and tile.y0 > 0:
        edges.append("top")
    if (tile.height - y1) <= margin and tile.y1 < image_height:
        edges.append("bottom")
    return edges


def _norm_text(text: str) -> str:
    return " ".join((text or "").strip().lower().split())


def _compact_text(text: str) -> str:
    return "".join(_norm_text(text).split())


def _cut_set(line: dict[str, Any]) -> set[str]:
    raw = line.get("cutEdges") or []
    if isinstance(raw, str):
        return {raw}
    return {str(x) for x in raw if x}


def _char_width(line: dict[str, Any], box: tuple[float, float, float, float]) -> float:
    compact = _compact_text(str(line.get("text") or ""))
    width = max(1.0, box[2] - box[0])
    return width / max(1, len(compact))


def _same_row(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    overlap = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    min_h = max(1.0, min(a[3] - a[1], b[3] - b[1]))
    if overlap < 0.4 * min_h:
        return False
    cy_a = (a[1] + a[3]) / 2
    cy_b = (b[1] + b[3]) / 2
    mean_h = max(1.0, ((a[3] - a[1]) + (b[3] - b[1])) / 2)
    return abs(cy_a - cy_b) <= 0.65 * mean_h


def _intersect_area(
    a: tuple[float, float, float, float],
    b: tuple[float, float, float, float],
) -> float:
    ix0 = max(a[0], b[0])
    iy0 = max(a[1], b[1])
    ix1 = min(a[2], b[2])
    iy1 = min(a[3], b[3])
    return max(0.0, ix1 - ix0) * max(0.0, iy1 - iy0)


def _text_key(text: str) -> str:
    """Compare OCR strings ignoring case, spaces, and punctuation."""
    return re.sub(r"[^a-z0-9]+", "", _norm_text(text))


def ocr_lines_near_duplicate(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """True when two detections are likely the same label in tile overlap."""
    ta = _text_key(str(a.get("text") or ""))
    tb = _text_key(str(b.get("text") or ""))
    if not ta or ta != tb:
        return False
    ca = _line_center(a)
    cb = _line_center(b)
    if ca is None or cb is None:
        return True
    ba, bb = _line_bbox(a), _line_bbox(b)
    if ba and bb:
        inter = _intersect_area(ba, bb)
        area_a = max(1.0, (ba[2] - ba[0]) * (ba[3] - ba[1]))
        area_b = max(1.0, (bb[2] - bb[0]) * (bb[3] - bb[1]))
        if inter / min(area_a, area_b) >= 0.22:
            return True
        w = max(ba[2] - ba[0], bb[2] - bb[0], 1.0)
        h = max(ba[3] - ba[1], bb[3] - bb[1], 1.0)
    elif ba or bb:
        box = ba or bb
        w = max(1.0, box[2] - box[0])
        h = max(1.0, box[3] - box[1])
    else:
        w, h = 40.0, 14.0
    # Use width, not min(w,h). Wide room labels jitter more horizontally across tiles.
    thresh = max(18.0, 0.45 * w, 0.9 * h)
    return math.hypot(ca[0] - cb[0], ca[1] - cb[1]) <= thresh


def _same_instance(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """True when two OCR boxes are the same physical text (tile overlap)."""
    ba = _line_bbox(a)
    bb = _line_bbox(b)
    ta = _norm_text(str(a.get("text") or ""))
    tb = _norm_text(str(b.get("text") or ""))
    if not ta or not tb:
        return False
    if ba is None or bb is None:
        return ocr_lines_near_duplicate(a, b)
    if not _same_row(ba, bb):
        return False
    area_a = max(1.0, (ba[2] - ba[0]) * (ba[3] - ba[1]))
    area_b = max(1.0, (bb[2] - bb[0]) * (bb[3] - bb[1]))
    inter = _intersect_area(ba, bb)
    containment = inter / min(area_a, area_b)
    union = area_a + area_b - inter
    iou = inter / union if union > 0 else 0.0
    if containment >= 0.55 or iou >= 0.4:
        return True
    if ta == tb or ta in tb or tb in ta:
        return ocr_lines_near_duplicate(a, b) or containment >= 0.28
    return False


def _suffix_prefix_stitch(left: str, right: str, min_k: int = 2) -> str | None:
    """Join fragments that share an overlapping tail/head, e.g. BEDROO + ROOM 1."""
    a = left.strip()
    b = right.strip()
    if not a or not b:
        return None
    na, nb = a.lower(), b.lower()
    for k in range(min(len(na), len(nb)), min_k - 1, -1):
        if na[-k:] == nb[:k]:
            return a + b[k:]
    return None


def _combine_text(left: str, right: str, *, min_overlap: int, allow_concat: bool) -> str:
    ls, rs = left.strip(), right.strip()
    if not ls:
        return rs
    if not rs:
        return ls
    nl, nr = _norm_text(ls), _norm_text(rs)
    if nl == nr:
        return ls if len(ls) >= len(rs) else rs
    if nl in nr:
        return rs
    if nr in nl:
        return ls
    stitched = _suffix_prefix_stitch(ls, rs, min_k=min_overlap)
    if stitched:
        return stitched
    if not allow_concat:
        return ls if len(ls) >= len(rs) else rs
    if ls.endswith("-"):
        return ls[:-1] + rs
    if ls.endswith((":", "/")):
        return ls + rs
    if ls[-1:].isalpha() and rs[:1].isalpha():
        return ls + rs
    return f"{ls} {rs}"


def _better_reading(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    ta = str(a.get("text") or "").strip()
    tb = str(b.get("text") or "").strip()
    ka, kb = _text_key(ta), _text_key(tb)
    cut_a = bool(_cut_set(a))
    cut_b = bool(_cut_set(b))
    if ka and kb:
        if ka == kb:
            punct_a = len(ta) - len(ka)
            punct_b = len(tb) - len(kb)
            if punct_a != punct_b:
                return a if punct_a < punct_b else b
        elif ka in kb and ka != kb:
            return b
        elif kb in ka and ka != kb:
            return a
    if cut_a != cut_b:
        return b if cut_a else a
    if abs(len(ka) - len(kb)) >= 2:
        return a if len(ka) > len(kb) else b
    ca = float(a.get("confidence") or 0)
    cb = float(b.get("confidence") or 0)
    if ca != cb:
        return a if ca > cb else b
    return a if len(ta) >= len(tb) else b


def _h_gap(left: tuple[float, float, float, float], right: tuple[float, float, float, float]) -> float:
    return right[0] - left[2]


def _should_stitch(a: dict[str, Any], b: dict[str, Any]) -> bool:
    ba = _line_bbox(a)
    bb = _line_bbox(b)
    if ba is None or bb is None or not _same_row(ba, bb):
        return False
    if _same_instance(a, b):
        return False
    left, right, box_l, box_r = (a, b, ba, bb) if ba[0] <= bb[0] else (b, a, bb, ba)
    gap = _h_gap(box_l, box_r)
    char_w = max(_char_width(left, box_l), _char_width(right, box_r), 4.0)
    if gap > 2.4 * char_w or gap < -1.2 * char_w:
        return False
    tl = str(left.get("text") or "")
    tr = str(right.get("text") or "")
    if _norm_text(tl) == _norm_text(tr):
        return False
    cut_l, cut_r = _cut_set(left), _cut_set(right)
    min_k = 2 if (cut_l or cut_r) else 3
    if _suffix_prefix_stitch(tl, tr, min_k=min_k):
        return ("right" in cut_l) or ("left" in cut_r) or gap <= 1.2 * char_w
    nl, nr = _norm_text(tl), _norm_text(tr)
    if nl in nr or nr in nl:
        return True
    if not (cut_l or cut_r):
        return False
    return gap <= 1.15 * char_w


def _should_merge(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return _same_instance(a, b) or ocr_lines_near_duplicate(a, b) or _should_stitch(a, b)


def _combine_pair(a: dict[str, Any], b: dict[str, Any]) -> dict[str, Any]:
    ba = _line_bbox(a)
    bb = _line_bbox(b)
    if ba is None or bb is None:
        return _better_reading(a, b)
    left, right = (a, b) if ba[0] <= bb[0] else (b, a)
    box = _union_box(ba, bb)
    if _same_instance(a, b) or ocr_lines_near_duplicate(a, b):
        chosen = _better_reading(a, b)
        out = {
            **chosen,
            "text": str(chosen.get("text") or "").strip(),
            "confidence": max(float(a.get("confidence") or 0), float(b.get("confidence") or 0)),
            "bbox": _quad_from_box(box),
        }
        out.pop("cutEdges", None)
        return out

    min_overlap = 2 if (_cut_set(left) or _cut_set(right)) else 3
    gap = _h_gap(_line_bbox(left) or ba, _line_bbox(right) or bb)
    char_w = max(
        _char_width(left, _line_bbox(left) or ba),
        _char_width(right, _line_bbox(right) or bb),
        4.0,
    )
    text = _combine_text(
        str(left.get("text") or ""),
        str(right.get("text") or ""),
        min_overlap=min_overlap,
        allow_concat=gap <= 1.2 * char_w,
    )
    out = {
        **_better_reading(left, right),
        "text": text,
        "confidence": max(float(a.get("confidence") or 0), float(b.get("confidence") or 0)),
        "bbox": _quad_from_box(box),
    }
    out.pop("cutEdges", None)
    return out


def _reduce_group(group: list[dict[str, Any]]) -> dict[str, Any]:
    ordered = sorted(group, key=lambda row: (_line_bbox(row) or (0.0, 0.0, 0.0, 0.0))[0])
    acc = ordered[0]
    for nxt in ordered[1:]:
        acc = _combine_pair(acc, nxt)
    return acc


def _public_line(line: dict[str, Any]) -> dict[str, Any]:
    out = dict(line)
    out.pop("cutEdges", None)
    out["text"] = str(out.get("text") or "").strip()
    return out


def merge_ocr_lines(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge overlapping-tile OCR: drop repeats, stitch lines cut at tile seams."""
    cleaned = [row for row in lines if str(row.get("text") or "").strip()]
    n = len(cleaned)
    if n <= 1:
        return [_public_line(row) for row in cleaned]

    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri

    for i in range(n):
        for j in range(i + 1, n):
            if _should_merge(cleaned[i], cleaned[j]):
                union(i, j)

    groups: dict[int, list[dict[str, Any]]] = {}
    for i, row in enumerate(cleaned):
        groups.setdefault(find(i), []).append(row)

    merged = [_public_line(_reduce_group(group)) for group in groups.values()]
    merged.sort(
        key=lambda row: (
            (_line_bbox(row) or (0.0, 0.0, 0.0, 0.0))[1],
            (_line_bbox(row) or (0.0, 0.0, 0.0, 0.0))[0],
        )
    )
    return merged


def run_tiled_ocr_lines(
    rgb: np.ndarray,
    *,
    run_ocr,
    settings: Settings | None = None,
    tile_size: int | None = None,
    overlap: float | None = None,
    min_side: int | None = None,
    on_progress: ProgressFn | None = None,
    cancel_check: CancelFn | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """
    Run ``run_ocr(crop_rgb) -> lines`` on overlapping tiles when the image is
    larger than PaddleOCR's default 960px detector input (same gate as YOLO imgsz).
    """
    settings = settings or get_settings()
    height, width = rgb.shape[:2]
    size = int(tile_size or settings.paddle_ocr_tile_size)
    gate = int(min_side or settings.paddle_ocr_tile_min_side)
    ov = float(overlap if overlap is not None else settings.paddle_ocr_tile_overlap)

    def emit(kind: str, payload: dict[str, Any]) -> None:
        if on_progress is not None:
            on_progress(kind, payload)

    full_tile = {"x": 0, "y": 0, "width": width, "height": height}
    if not should_tile(height, width, tile_size=size, min_side=gate):
        if cancel_check is not None and cancel_check():
            raise OcrCancelled()
        emit("meta", {"tiled": False, "tileCount": 1, "tileSize": size, "width": width, "height": height})
        emit("tile_start", {"index": 1, "total": 1, "tile": full_tile})
        lines = run_ocr(rgb)
        emit(
            "tile_done",
            {"index": 1, "total": 1, "tile": full_tile, "lineCount": len(lines)},
        )
        return lines, {"tiled": False, "tileCount": 1, "tileSize": size, "width": width, "height": height}

    tiles: list[TileWindow] = iter_tiles(height, width, size, ov)
    total = len(tiles)
    emit(
        "meta",
        {
            "tiled": True,
            "tileCount": total,
            "tileSize": size,
            "overlap": ov,
            "width": width,
            "height": height,
        },
    )
    merged: list[dict[str, Any]] = []
    for index, tile in enumerate(tiles, start=1):
        if cancel_check is not None and cancel_check():
            raise OcrCancelled()
        emit("tile_start", {"index": index, "total": total, "tile": tile.as_dict()})
        crop = np.ascontiguousarray(rgb[tile.y0 : tile.y1, tile.x0 : tile.x1])
        tile_lines = run_ocr(crop)
        for line in tile_lines:
            cuts = cut_edges_for_local_line(line, tile, width, height)
            merged.append(
                offset_ocr_line(line, float(tile.x0), float(tile.y0), cut_edges=cuts or None)
            )
        emit(
            "tile_done",
            {
                "index": index,
                "total": total,
                "tile": tile.as_dict(),
                "lineCount": len(tile_lines),
            },
        )

    return merge_ocr_lines(merged), {
        "tiled": True,
        "tileCount": total,
        "tileSize": size,
        "overlap": ov,
        "width": width,
        "height": height,
    }
