"""Build Building → Floor → Unit → Room hierarchy from analysis pages + graph."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
import re

from app.pipeline.geometry import is_common_label


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _unit_sort_key(label: str) -> tuple[int, str, str]:
    raw = (label or "").strip()
    stripped = re.sub(r"(?i)^unit[\s#:-]*", "", raw).strip()
    match = re.search(r"(\d+)", stripped)
    if not match:
        return (10**9, stripped.lower(), raw.lower())
    n = int(match.group(1))
    suffix = stripped[match.end() :].lstrip(" ._-" ).lower()
    return (n, suffix, raw.lower())


def _room_type_bucket(space_type: str) -> str:
    t = (space_type or "").lower()
    if "bed" in t:
        return "bedroom"
    if "bath" in t or "ensuite" in t or "toilet" in t:
        return "bathroom"
    if "balcon" in t or "terrace" in t:
        return "balcony"
    if "living" in t:
        return "living"
    return t or "room"


def _as_dict(obj: Any) -> dict[str, Any]:
    if hasattr(obj, "model_dump"):
        return obj.model_dump(by_alias=False)
    if hasattr(obj, "dict"):
        return obj.dict()
    return dict(obj)


def build_building_hierarchy(
    *,
    analysis_id: str,
    project_id: str,
    source_file_name: str,
    pages: list[Any],
    spaces: list[Any],
    units: list[Any],
    openings: list[Any] | None = None,
    relationships: list[dict[str, Any]] | None = None,
    building_id: str | None = None,
    building_name: str | None = None,
) -> dict[str, Any]:
    """Assemble a BuildingHierarchy dict with snake_case keys for AnalysisResultSchema."""
    space_dicts = [_as_dict(s) for s in spaces]
    unit_dicts = [_as_dict(u) for u in units]
    opening_dicts = [_as_dict(o) for o in (openings or [])]
    rels = list(relationships or [])

    room_to_unit: dict[str, str] = {}
    for u in unit_dicts:
        uid = str(u.get("id") or "")
        for sid in u.get("space_ids") or []:
            room_to_unit[str(sid)] = uid
    for s in space_dicts:
        sid = str(s.get("id") or "")
        uid = s.get("unit_id")
        if uid:
            room_to_unit[sid] = str(uid)

    object_parent_room: dict[str, str] = {}
    for r in rels:
        kind = str(r.get("kind") or r.get("type") or "")
        if kind in {"room_door_access", "room_window_access", "room_contains_fixture"}:
            object_parent_room[str(r.get("toId") or r.get("toEntityId"))] = str(
                r.get("fromId") or r.get("fromEntityId")
            )

    rooms_out: list[dict[str, Any]] = []
    for s in space_dicts:
        sid = str(s.get("id") or "")
        label = str(s.get("external_id") or s.get("space_type") or "Room")
        space_type = str(s.get("space_type") or label)
        is_common = bool(s.get("is_common")) or is_common_label(label) or is_common_label(space_type)
        unit_id = None if is_common else room_to_unit.get(sid)
        rooms_out.append(
            {
                "id": sid,
                "label": label,
                "room_type": space_type,
                "unit_id": unit_id,
                "is_common": is_common,
                "area_m2": s.get("area_m2"),
                "confidence": float(s.get("confidence") or 0.5),
                "object_ids": [],
            }
        )

    room_by_id = {r["id"]: r for r in rooms_out}

    objects_out: list[dict[str, Any]] = []
    for o in opening_dicts:
        oid = str(o.get("id") or "")
        kind = str(o.get("opening_type") or "other")
        if kind not in {"door", "window", "fixture", "stair", "other"}:
            kind = "other"
        parent_room = object_parent_room.get(oid)
        parent_unit = (
            room_by_id[parent_room]["unit_id"] if parent_room and parent_room in room_by_id else None
        )
        objects_out.append(
            {
                "id": oid,
                "kind": kind,
                "label": str(o.get("external_id") or kind),
                "parent_room_id": parent_room,
                "parent_unit_id": parent_unit,
                "confidence": float(o.get("confidence") or 0.5),
            }
        )
        if parent_room and parent_room in room_by_id:
            room_by_id[parent_room]["object_ids"].append(oid)

    units_out: list[dict[str, Any]] = []
    for u in unit_dicts:
        uid = str(u.get("id") or "")
        space_ids = [str(x) for x in (u.get("space_ids") or [])]
        space_ids = [
            sid for sid in space_ids if sid in room_by_id and not room_by_id[sid]["is_common"]
        ]
        u_rooms = [room_by_id[sid] for sid in space_ids if sid in room_by_id]
        units_out.append(
            {
                "id": uid,
                "label": str(u.get("external_id") or "Unit"),
                "area_m2": u.get("area_m2"),
                "room_ids": space_ids,
                "bedroom_count": sum(
                    1 for r in u_rooms if _room_type_bucket(r["room_type"]) == "bedroom"
                ),
                "bathroom_count": sum(
                    1 for r in u_rooms if _room_type_bucket(r["room_type"]) == "bathroom"
                ),
                "confidence": float(u.get("confidence") or 0.7),
                "review_required": bool(u.get("review_required")),
            }
        )

    units_out.sort(key=lambda u: _unit_sort_key(str(u.get("label") or "")))
    floors_out: list[dict[str, Any]] = []
    page_list = list(pages) if pages else [{"id": "page-1", "page_number": 1, "is_floor_plan": True}]

    all_unit_ids = [u["id"] for u in units_out]
    common_ids = [r["id"] for r in rooms_out if r["is_common"]]
    assigned = {sid for u in units_out for sid in u["room_ids"]}
    unassigned = [r["id"] for r in rooms_out if not r["is_common"] and r["id"] not in assigned]

    for page in page_list:
        page_d = _as_dict(page) if not isinstance(page, dict) else page
        page_id = str(page_d.get("id") or page_d.get("page_id") or "page-1")
        page_number = int(page_d.get("page_number") or page_d.get("pageNumber") or 1)
        level_index = page_d.get("level_index")
        if level_index is None:
            level_index = page_d.get("levelIndex")
        if level_index is None:
            level_index = page_number - 1
        level_name = page_d.get("level_name") or page_d.get("levelName") or f"Floor {page_number}"
        floor_id = str(page_d.get("floor_id") or page_d.get("floorId") or f"floor-{page_id}")
        is_fp = bool(page_d.get("is_floor_plan", page_d.get("isFloorPlan", True)))
        if not is_fp:
            continue

        private_area = sum(
            float(r["area_m2"] or 0)
            for r in rooms_out
            if r["id"] in assigned and r.get("area_m2") is not None
        )
        common_area = sum(
            float(r["area_m2"] or 0) for r in rooms_out if r["is_common"] and r.get("area_m2") is not None
        )

        floors_out.append(
            {
                "id": floor_id,
                "level_name": str(level_name),
                "level_index": int(level_index),
                "page_id": page_id,
                "page_number": page_number,
                "document_id": page_d.get("document_id") or page_d.get("documentId"),
                "source_file_name": page_d.get("source_file_name")
                or page_d.get("sourceFileName")
                or source_file_name,
                "is_floor_plan": True,
                "unit_ids": list(all_unit_ids),
                "common_area_ids": list(common_ids),
                "unassigned_room_ids": list(unassigned),
                "properties": {
                    "unit_count": len(all_unit_ids),
                    "room_count": len(rooms_out),
                    "common_area_count": len(common_ids),
                    "gross_area_m2": (private_area + common_area) or None,
                    "common_area_m2": common_area or None,
                },
            }
        )

    floors_out.sort(key=lambda f: (f["level_index"], f["page_number"]))
    now = _utcnow()
    return {
        "schema_version": "1.0.0",
        "building_id": building_id or project_id,
        "project_id": project_id,
        "analysis_id": analysis_id,
        "name": building_name or source_file_name or "Building",
        "floors": floors_out,
        "units": units_out,
        "rooms": rooms_out,
        "objects": objects_out,
        "created_at": now,
        "updated_at": now,
    }
