"""CPU geometry helpers: containment, adjacency, openings on rooms."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

COMMON_AREA_LABELS = {
    "communal space",
    "lobby",
    "stair",
    "lift",
    "common corridor",
    "common_corridor",
    "corridor",
    "hallway",
    "elevator",
}


def _norm(label: str) -> str:
    return " ".join((label or "").strip().lower().replace("_", " ").replace("-", " ").split())


def is_common_label(label: str) -> bool:
    n = _norm(label)
    if n in COMMON_AREA_LABELS:
        return True
    return any(token in n for token in ("communal", "common corridor", "lobby"))


def _poly(entity: dict[str, Any]) -> list[tuple[float, float]]:
    pts = entity.get("polygonPx") or []
    out: list[tuple[float, float]] = []
    for p in pts:
        if isinstance(p, dict):
            out.append((float(p["x"]), float(p["y"])))
        elif isinstance(p, (list, tuple)) and len(p) >= 2:
            out.append((float(p[0]), float(p[1])))
    return out


def _bbox(entity: dict[str, Any]) -> tuple[float, float, float, float]:
    b = entity.get("bboxPx") or {}
    if b:
        x, y = float(b.get("x") or 0), float(b.get("y") or 0)
        return x, y, x + float(b.get("width") or 0), y + float(b.get("height") or 0)
    poly = _poly(entity)
    if not poly:
        return 0.0, 0.0, 0.0, 0.0
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return min(xs), min(ys), max(xs), max(ys)


def _centroid(entity: dict[str, Any]) -> tuple[float, float]:
    poly = _poly(entity)
    if len(poly) >= 3:
        # Polygon centroid (shoelace); fall back to bbox center.
        area = 0.0
        cx = 0.0
        cy = 0.0
        n = len(poly)
        for i in range(n):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % n]
            cross = x1 * y2 - x2 * y1
            area += cross
            cx += (x1 + x2) * cross
            cy += (y1 + y2) * cross
        area *= 0.5
        if abs(area) > 1e-6:
            return cx / (6.0 * area), cy / (6.0 * area)
    x0, y0, x1, y1 = _bbox(entity)
    return (x0 + x1) / 2.0, (y0 + y1) / 2.0


def _point_in_bbox(px: float, py: float, box: tuple[float, float, float, float]) -> bool:
    x0, y0, x1, y1 = box
    return x0 <= px <= x1 and y0 <= py <= y1


def _bbox_overlap(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> bool:
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


def _expand(box: tuple[float, float, float, float], pad: float) -> tuple[float, float, float, float]:
    return box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad


def _bbox_area(box: tuple[float, float, float, float]) -> float:
    return max(0.0, box[2] - box[0]) * max(0.0, box[3] - box[1])


def _intersection_area(
    a: tuple[float, float, float, float], b: tuple[float, float, float, float]
) -> float:
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    return max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)


def _point_in_poly(px: float, py: float, poly: list[tuple[float, float]]) -> bool:
    if len(poly) < 3:
        return False
    try:
        from shapely.geometry import Point, Polygon

        return bool(Polygon(poly).buffer(0).contains(Point(px, py)))
    except Exception:
        # Ray casting fallback
        inside = False
        n = len(poly)
        j = n - 1
        for i in range(n):
            xi, yi = poly[i]
            xj, yj = poly[j]
            if ((yi > py) != (yj > py)) and (
                px < (xj - xi) * (py - yi) / ((yj - yi) or 1e-12) + xi
            ):
                inside = not inside
            j = i
        return inside


def room_in_unit(
    room: dict[str, Any],
    unit: dict[str, Any],
    *,
    overlap_frac: float = 0.5,
) -> tuple[bool, str]:
    """True if room belongs to unit via polygon centroid or bbox overlap fraction."""
    upoly = _poly(unit)
    cx, cy = _centroid(room)
    if upoly and _point_in_poly(cx, cy, upoly):
        return True, "room_centroid_in_unit_polygon"
    ubox = _bbox(unit)
    if _point_in_bbox(cx, cy, ubox):
        return True, "room_centroid_in_unit_bbox"
    rbox = _bbox(room)
    ra = _bbox_area(rbox)
    if ra <= 0:
        return False, "empty"
    frac = _intersection_area(rbox, ubox) / ra
    if frac >= overlap_frac:
        return True, f"bbox_overlap_frac={frac:.2f}"
    return False, "none"


def derive_relationships(
    entities: list[dict[str, Any]],
    *,
    adjacency_pad_px: float = 24.0,
) -> list[dict[str, Any]]:
    """Build room_door_access, room_window_access, room_adjacency, unit_contains_room."""
    rooms = [e for e in entities if str(e.get("type")) == "room"]
    doors = [e for e in entities if str(e.get("type")) == "door"]
    windows = [e for e in entities if str(e.get("type")) == "window"]
    fixtures = [e for e in entities if str(e.get("type")) in {"fixture", "stair"}]
    units = [e for e in entities if str(e.get("type")) == "unit_boundary"]
    rels: list[dict[str, Any]] = []

    def add(kind: str, a: str, b: str, **attrs: Any) -> None:
        rels.append(
            {
                "id": str(uuid4()),
                "kind": kind,
                "type": kind,  # scene-graph compatible alias
                "fromId": a,
                "fromEntityId": a,
                "toId": b,
                "toEntityId": b,
                "confidence": float(attrs.pop("confidence", 0.8)),
                "attributes": attrs,
            }
        )

    for opening in doors + windows:
        cx, cy = _centroid(opening)
        kind = "room_door_access" if opening.get("type") == "door" else "room_window_access"
        best = None
        best_area = float("inf")
        for room in rooms:
            box = _bbox(room)
            if not _point_in_bbox(cx, cy, _expand(box, adjacency_pad_px)):
                continue
            area = max(1.0, (box[2] - box[0]) * (box[3] - box[1]))
            if area < best_area:
                best_area = area
                best = room
        if best is not None:
            add(kind, str(best["id"]), str(opening["id"]), method="centroid_in_room_bbox")

    for fixture in fixtures:
        cx, cy = _centroid(fixture)
        best = None
        best_area = float("inf")
        for room in rooms:
            poly = _poly(room)
            box = _bbox(room)
            inside = _point_in_poly(cx, cy, poly) if poly else _point_in_bbox(cx, cy, box)
            if not inside:
                continue
            area = max(1.0, _bbox_area(box))
            if area < best_area:
                best_area = area
                best = room
        if best is not None:
            add(
                "room_contains_fixture",
                str(best["id"]),
                str(fixture["id"]),
                method="centroid_in_room",
            )

    for i, a in enumerate(rooms):
        box_a = _expand(_bbox(a), adjacency_pad_px)
        for b in rooms[i + 1 :]:
            if _bbox_overlap(box_a, _expand(_bbox(b), adjacency_pad_px)):
                add("room_adjacency", str(a["id"]), str(b["id"]), method="bbox_pad_overlap")

    for unit in units:
        for room in rooms:
            label = str((room.get("attributes") or {}).get("label") or "")
            if is_common_label(label):
                continue
            ok, method = room_in_unit(room, unit)
            if ok:
                add(
                    "unit_contains_room",
                    str(unit["id"]),
                    str(room["id"]),
                    method=method,
                )

    for unit in units:
        uattrs = unit.get("attributes") or {}
        unit_label = str(uattrs.get("ocrUnitId") or uattrs.get("label") or "")
        if unit_label:
            add(
                "room_label_assignment",
                str(unit["id"]),
                str(unit["id"]),
                label=unit_label,
                source="unit",
            )
        contained = [r for r in rels if r.get("kind") == "unit_contains_room" and str(r.get("fromId")) == str(unit["id"])]
        for rel in contained:
            add(
                "room_label_assignment",
                str(rel["toId"]),
                str(unit["id"]),
                label=unit_label or str((unit.get("attributes") or {}).get("label") or ""),
                source="unit_contains_room",
            )

    return rels


def _is_unit_entrance(door: dict[str, Any]) -> bool:
    attrs = door.get("attributes") or {}
    if str(attrs.get("openingType") or "") == "unit_entrance":
        return True
    return "main door" in _norm(str(attrs.get("label") or ""))


def _doors_in_unit(
    unit: dict[str, Any],
    doors: list[dict[str, Any]],
    *,
    pad_px: float = 24.0,
) -> list[dict[str, Any]]:
    ubox = _expand(_bbox(unit), pad_px)
    upoly = _poly(unit)
    hits: list[dict[str, Any]] = []
    for door in doors:
        cx, cy = _centroid(door)
        if upoly and _point_in_poly(cx, cy, upoly):
            hits.append(door)
        elif _point_in_bbox(cx, cy, ubox):
            hits.append(door)
    return hits


def _entrance_ids_for_unit(unit: dict[str, Any], doors: list[dict[str, Any]]) -> list[str]:
    in_unit = _doors_in_unit(unit, doors)
    attributed = list((unit.get("attributes") or {}).get("entranceIds") or [])
    if attributed:
        return [str(x) for x in attributed]
    entrances = [d for d in in_unit if _is_unit_entrance(d)]
    chosen = entrances if entrances else in_unit[:1]
    return [str(d["id"]) for d in chosen]


def units_from_entities(
    entities: list[dict[str, Any]],
    relationships: list[dict[str, Any]],
    *,
    width_px: int,
    height_px: int,
    area_by_room: dict[str, float | None],
) -> list[dict[str, Any]]:
    """Prefer labelled unit_boundary entities; else one page-level unit of private rooms only."""
    rooms = [e for e in entities if str(e.get("type")) == "room"]
    doors = [e for e in entities if str(e.get("type")) == "door"]
    units = [e for e in entities if str(e.get("type")) == "unit_boundary"]
    contains = [r for r in relationships if r.get("kind") == "unit_contains_room"]

    def is_common_room(room: dict[str, Any]) -> bool:
        label = str((room.get("attributes") or {}).get("label") or "")
        return is_common_label(label)

    private_rooms = [r for r in rooms if not is_common_room(r)]

    def room_ids_for(unit_id: str) -> list[str]:
        hit = [str(r["toId"]) for r in contains if str(r.get("fromId")) == unit_id]
        return hit

    out: list[dict[str, Any]] = []
    if units:
        for unit in units:
            uid = str(unit["id"])
            space_ids = room_ids_for(uid)
            label = str((unit.get("attributes") or {}).get("label") or "Unit")
            poly = [[p[0], p[1]] for p in _poly(unit)]
            if len(poly) < 3:
                x0, y0, x1, y1 = _bbox(unit)
                poly = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
            area = sum(area_by_room.get(sid) or 0 for sid in space_ids) or None
            out.append(
                {
                    "id": uid,
                    "external_id": label,
                    "geometry": poly,
                    "area_m2": area,
                    "space_ids": space_ids,
                    "entrance_ids": _entrance_ids_for_unit(unit, doors),
                    "confidence": float(unit.get("confidence") or 0.7),
                    "review_required": str(unit.get("status")) == "predicted",
                }
            )
        return out

    # Fallback: single page unit of private rooms only (common areas excluded).
    space_ids = [str(r["id"]) for r in private_rooms]
    return [
        {
            "id": str(uuid4()),
            "external_id": "unit-1",
            "geometry": [[0, 0], [width_px, 0], [width_px, height_px], [0, height_px]],
            "area_m2": sum(area_by_room.get(sid) or 0 for sid in space_ids) or None,
            "space_ids": space_ids,
            "entrance_ids": [str(d["id"]) for d in doors if _is_unit_entrance(d)][:1]
            or [str(d["id"]) for d in doors][:1],
            "confidence": 0.6,
            "review_required": any(str(r.get("status")) == "predicted" for r in rooms),
        }
    ]
