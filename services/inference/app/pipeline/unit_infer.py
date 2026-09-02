"""Infer unit_boundary polygons from private-room / door clustering.

Lobby and corridor rooms split the graph so each apartment is a connected
component of private rooms. YOLO Unit polygons are kept; remaining rooms
outside those polygons become inferred units.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from app.pipeline.geometry import (
    _bbox,
    _centroid,
    _expand,
    _point_in_bbox,
    _poly,
    is_common_label,
    room_in_unit,
)
from app.yolo.classes import opening_type_for


def _label(entity: dict[str, Any]) -> str:
    return str((entity.get("attributes") or {}).get("label") or "")


def _norm(label: str) -> str:
    return " ".join((label or "").strip().lower().replace("_", " ").replace("-", " ").split())


def _is_main_door(entity: dict[str, Any]) -> bool:
    attrs = entity.get("attributes") or {}
    if str(attrs.get("openingType") or "") == "unit_entrance":
        return True
    return _norm(_label(entity)) == "main door"


def stamp_opening_types(entities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for entity in entities:
        et = str(entity.get("type") or "")
        if et not in {"door", "window"}:
            continue
        attrs = dict(entity.get("attributes") or {})
        if attrs.get("openingType"):
            continue
        ot = opening_type_for(str(attrs.get("label") or entity.get("label") or ""))
        if ot:
            attrs["openingType"] = ot
            entity["attributes"] = attrs
    return entities


def _convex_hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    pts = sorted(set(points))
    if len(pts) <= 2:
        return pts

    def cross(o: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[tuple[float, float]] = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper: list[tuple[float, float]] = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def _near(door: dict[str, Any], room: dict[str, Any], pad: float) -> bool:
    cx, cy = _centroid(door)
    return _point_in_bbox(cx, cy, _expand(_bbox(room), pad))


class _UF:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, i: int) -> int:
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def union(self, a: int, b: int) -> None:
        pa, pb = self.find(a), self.find(b)
        if pa != pb:
            self.parent[pa] = pb


def cluster_private_rooms(
    rooms: list[dict[str, Any]],
    doors: list[dict[str, Any]],
    *,
    pad_px: float,
) -> list[dict[str, Any]]:
    """Return clusters: {room_ids, entrance_ids} of private rooms split at lobby/corridor."""
    private = [r for r in rooms if not is_common_label(_label(r))]
    common = [r for r in rooms if is_common_label(_label(r))]
    if not private:
        return []
    uf = _UF(len(private))
    entrances: dict[int, list[str]] = {i: [] for i in range(len(private))}

    for door in doors:
        near_private = [i for i, r in enumerate(private) if _near(door, r, pad_px)]
        near_common = any(_near(door, r, pad_px) for r in common)
        main = _is_main_door(door)
        if len(near_private) >= 2 and not main:
            for i in near_private[1:]:
                uf.union(near_private[0], i)
        if (main or near_common) and near_private:
            for i in near_private:
                entrances[i].append(str(door["id"]))

    groups: dict[int, list[int]] = {}
    for i in range(len(private)):
        groups.setdefault(uf.find(i), []).append(i)

    out: list[dict[str, Any]] = []
    for idxs in groups.values():
        room_ids = [str(private[i]["id"]) for i in idxs]
        entrance_ids: list[str] = []
        seen: set[str] = set()
        for i in idxs:
            for eid in entrances[i]:
                if eid in seen:
                    continue
                seen.add(eid)
                entrance_ids.append(eid)
        out.append({"room_ids": room_ids, "entrance_ids": entrance_ids, "rooms": [private[i] for i in idxs]})
    return out


def _unit_entity_from_rooms(
    rooms: list[dict[str, Any]],
    *,
    label: str,
    entrance_ids: list[str],
    method: str,
) -> dict[str, Any]:
    pts: list[tuple[float, float]] = []
    for room in rooms:
        pts.extend(_poly(room))
        if not _poly(room):
            x0, y0, x1, y1 = _bbox(room)
            pts.extend([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])
    hull = _convex_hull(pts)
    if len(hull) < 3:
        xs = [p[0] for p in pts] or [0.0]
        ys = [p[1] for p in pts] or [0.0]
        hull = [(min(xs), min(ys)), (max(xs), min(ys)), (max(xs), max(ys)), (min(xs), max(ys))]
    xs = [p[0] for p in hull]
    ys = [p[1] for p in hull]
    uid = str(uuid4())
    return {
        "id": uid,
        "type": "unit_boundary",
        "bboxPx": {
            "x": min(xs),
            "y": min(ys),
            "width": max(xs) - min(xs),
            "height": max(ys) - min(ys),
        },
        "polygonPx": [{"x": x, "y": y} for x, y in hull],
        "attributes": {
            "label": label,
            "inferred": True,
            "method": method,
            "entranceIds": entrance_ids,
            "roomIds": [str(r["id"]) for r in rooms],
        },
        "confidence": 0.55,
        "status": "predicted",
    }


def infer_and_merge_units(
    entities: list[dict[str, Any]],
    *,
    width_px: int,
    height_px: int,
) -> list[dict[str, Any]]:
    """Keep YOLO units; cluster leftover private rooms into inferred unit_boundary entities."""
    stamp_opening_types(entities)
    rooms = [e for e in entities if str(e.get("type")) == "room"]
    doors = [e for e in entities if str(e.get("type")) == "door"]
    units = [e for e in entities if str(e.get("type")) == "unit_boundary"]
    private = [r for r in rooms if not is_common_label(_label(r))]
    owned: set[str] = set()
    for unit in units:
        for room in private:
            ok, _ = room_in_unit(room, unit)
            if ok:
                owned.add(str(room["id"]))

    remaining = [r for r in private if str(r["id"]) not in owned]
    if not remaining or not doors:
        return entities

    pad = max(24.0, min(float(width_px), float(height_px)) * 0.015)
    clusters = cluster_private_rooms(rooms, doors, pad_px=pad)
    inferred: list[dict[str, Any]] = []
    for i, cluster in enumerate(clusters):
        free = [r for r in cluster["rooms"] if str(r["id"]) not in owned]
        if not free:
            continue
        cx = sum(_centroid(r)[0] for r in free) / len(free)
        inferred.append(
            _unit_entity_from_rooms(
                free,
                label=f"Unit {i + 1}",
                entrance_ids=list(cluster["entrance_ids"]),
                method="room_door_cluster",
            )
        )
        # Stable left-to-right labels applied after sort.
        inferred[-1]["_sort_x"] = cx

    inferred.sort(key=lambda e: float(e.get("_sort_x", 0)))
    for i, entity in enumerate(inferred):
        entity.pop("_sort_x", None)
        attrs = dict(entity.get("attributes") or {})
        attrs["label"] = f"Unit {i + 1}"
        entity["attributes"] = attrs
    return entities + inferred
