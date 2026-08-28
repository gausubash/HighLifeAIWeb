"""Tiled-instance post-process: SAHI-style NMM + polygon union.

Greedy NMS after overlapping tiles *drops* the lower-confidence mask. For
segmentation we merge matching same-class instances (union) instead, and explode
MultiPolygon so no fragment is discarded.
"""

from __future__ import annotations

from uuid import uuid4

from app.yolo.predict import DetectedRegion


def bbox_iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ax2, ay2 = ax + aw, ay + ah
    bx2, by2 = bx + bw, by + bh
    ix1, iy1 = max(ax, bx), max(ay, by)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter <= 0:
        return 0.0
    union = aw * ah + bw * bh - inter
    return float(inter / union) if union > 0 else 0.0


def bbox_ios(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    """Intersection-over-smaller — SAHI's usual tiled-instance match metric."""
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ax2, ay2 = ax + aw, ay + ah
    bx2, by2 = bx + bw, by + bh
    ix1, iy1 = max(ax, bx), max(ay, by)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter <= 0:
        return 0.0
    smaller = min(max(aw * ah, 1e-6), max(bw * bh, 1e-6))
    return float(inter / smaller)


def _as_shapely(pts: list[tuple[float, float]]):
    if len(pts) < 3:
        return None
    try:
        from shapely.geometry import Polygon
    except ImportError:
        return None
    try:
        poly = Polygon(pts)
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty:
            return None
        return poly
    except Exception:
        return None


def _coords_from_polygon(poly, *, max_vertices: int = 80) -> list[tuple[float, float]] | None:
    if poly is None or getattr(poly, "is_empty", True) or poly.geom_type != "Polygon":
        return None
    geom = poly
    try:
        n = len(geom.exterior.coords) - 1
        if n > max_vertices:
            simplified = geom.simplify(
                max(1.0, (float(geom.area) ** 0.5) * 0.01),
                preserve_topology=True,
            )
            if simplified.geom_type == "Polygon" and not simplified.is_empty:
                geom = simplified
    except Exception:
        geom = poly
    coords = list(geom.exterior.coords)
    if len(coords) < 4:
        return None
    return [(float(x), float(y)) for x, y in coords[:-1]]


def _explode_polygons(geom) -> list[list[tuple[float, float]]]:
    if geom is None or getattr(geom, "is_empty", True):
        return []
    kind = getattr(geom, "geom_type", "")
    if kind == "Polygon":
        coords = _coords_from_polygon(geom)
        return [coords] if coords else []
    parts: list[list[tuple[float, float]]] = []
    geoms = getattr(geom, "geoms", None)
    if geoms is None:
        return []
    for child in geoms:
        parts.extend(_explode_polygons(child))
    return parts


def union_polygon_parts(
    polygons: list[list[tuple[float, float]]],
) -> list[list[tuple[float, float]]] | None:
    """Shapely unary union. Explodes MultiPolygon so no piece is dropped.

    Returns None if union is unavailable — caller must keep the originals
    (never an axis-aligned fill rectangle).
    """
    geoms = []
    for pts in polygons:
        geom = _as_shapely(pts)
        if geom is not None:
            geoms.append(geom)
    if not geoms:
        return None
    try:
        from shapely.ops import unary_union

        merged = unary_union(geoms) if len(geoms) > 1 else geoms[0]
    except Exception:
        return None
    parts = _explode_polygons(merged)
    return parts or None


def region_on_tile_edge(region: DetectedRegion, margin: float = 8.0) -> bool:
    tile = (region.attributes or {}).get("tile")
    if not isinstance(tile, dict):
        return False
    try:
        tx = float(tile.get("x", 0))
        ty = float(tile.get("y", 0))
        tw = float(tile.get("width", 0))
        th = float(tile.get("height", 0))
    except (TypeError, ValueError):
        return False
    if tw <= 1 or th <= 1:
        return False
    x, y, w, h = region.bbox
    return (
        abs(x - tx) <= margin
        or abs((x + w) - (tx + tw)) <= margin
        or abs(y - ty) <= margin
        or abs((y + h) - (ty + th)) <= margin
    )


def instances_match(
    a: DetectedRegion,
    b: DetectedRegion,
    geom_a,
    geom_b,
    *,
    iou_threshold: float,
) -> bool:
    """Match same-class tiled instances via IoU, IoS, or a tile-seam touch."""
    if str(a.type) != str(b.type) or str(a.label) != str(b.label):
        return False
    ios_threshold = min(0.5, max(0.3, float(iou_threshold)))
    if geom_a is not None and geom_b is not None:
        try:
            inter = geom_a.intersection(geom_b)
            inter_area = float(inter.area) if inter is not None and not inter.is_empty else 0.0
            area_a = max(float(geom_a.area), 1e-6)
            area_b = max(float(geom_b.area), 1e-6)
            union = area_a + area_b - inter_area
            iou = inter_area / union if union > 0 else 0.0
            ios = inter_area / min(area_a, area_b)
            if iou >= iou_threshold or ios >= ios_threshold:
                return True
            edge = region_on_tile_edge(a) or region_on_tile_edge(b)
            if edge and inter_area > 0:
                return True
            if region_on_tile_edge(a) and region_on_tile_edge(b):
                if geom_a.intersects(geom_b) or geom_a.touches(geom_b):
                    return True
        except Exception:
            pass
    iou = bbox_iou(a.bbox, b.bbox)
    ios = bbox_ios(a.bbox, b.bbox)
    if iou >= iou_threshold or ios >= ios_threshold:
        return True
    if (region_on_tile_edge(a) or region_on_tile_edge(b)) and ios >= 0.08:
        return True
    return False


def _emit_unioned_group(group: list[DetectedRegion]) -> list[DetectedRegion]:
    if len(group) == 1:
        return group
    ordered = sorted(group, key=lambda r: float(r.confidence), reverse=True)
    parts = union_polygon_parts([r.polygon for r in ordered if len(r.polygon) >= 3])
    if not parts:
        return ordered
    conf = max(float(r.confidence) for r in ordered)
    attrs = dict(ordered[0].attributes or {})
    attrs["stitchedFrom"] = len(group)
    attrs.pop("tile", None)
    out: list[DetectedRegion] = []
    for poly in parts:
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        bbox = (min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))
        out.append(
            DetectedRegion(
                id=str(uuid4()),
                type=ordered[0].type,
                label=ordered[0].label,
                confidence=conf,
                polygon=poly,
                bbox=bbox,
                attributes=dict(attrs),
            )
        )
    return out


def merge_tiled_regions(
    regions: list[DetectedRegion],
    *,
    iou_threshold: float = 0.45,
) -> list[DetectedRegion]:
    """
    SAHI Greedy Non-Maximum Merging for tiled detection/segmentation.

    Same (type, label) predictions that overlap (IoU / IoS) or meet at a tile
    seam are unioned, not suppressed. MultiPolygon unions explode into parts so
    geometry is never discarded. Distinct side-by-side instances stay separate.
    """
    if len(regions) <= 1:
        return regions

    geoms = [_as_shapely(r.polygon) for r in regions]
    parent = list(range(len(regions)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri

    for i in range(len(regions)):
        for j in range(i + 1, len(regions)):
            if instances_match(
                regions[i],
                regions[j],
                geoms[i],
                geoms[j],
                iou_threshold=iou_threshold,
            ):
                union(i, j)

    groups: dict[int, list[DetectedRegion]] = {}
    for i, region in enumerate(regions):
        groups.setdefault(find(i), []).append(region)

    merged: list[DetectedRegion] = []
    for group in groups.values():
        merged.extend(_emit_unioned_group(group))
    merged.sort(key=lambda r: float(r.confidence), reverse=True)
    return merged
