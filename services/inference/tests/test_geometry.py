"""Phase 5 geometry relationships."""

from __future__ import annotations

from app.pipeline.geometry import derive_relationships, units_from_entities


def _entity(eid: str, etype: str, box: tuple[float, float, float, float], label: str = "") -> dict:
    x, y, w, h = box
    return {
        "id": eid,
        "type": etype,
        "bboxPx": {"x": x, "y": y, "width": w, "height": h},
        "polygonPx": [
            {"x": x, "y": y},
            {"x": x + w, "y": y},
            {"x": x + w, "y": y + h},
            {"x": x, "y": y + h},
        ],
        "attributes": {"label": label or etype},
        "confidence": 0.9,
        "status": "predicted",
    }


def test_door_room_access_and_unit_contains() -> None:
    entities = [
        _entity("u1", "unit_boundary", (0, 0, 200, 200), "Unit A"),
        _entity("r1", "room", (20, 20, 80, 80), "Bedroom"),
        _entity("r2", "room", (110, 20, 70, 70), "Bathroom"),
        _entity("d1", "door", (40, 50, 10, 10), "Single Door"),
    ]
    rels = derive_relationships(entities)
    kinds = {r["kind"] for r in rels}
    assert "room_door_access" in kinds
    assert "unit_contains_room" in kinds
    assert "room_adjacency" in kinds

    units = units_from_entities(
        entities,
        rels,
        width_px=200,
        height_px=200,
        area_by_room={"r1": 12.0, "r2": 5.0},
    )
    assert len(units) == 1
    assert units[0]["external_id"] == "Unit A"
    assert set(units[0]["space_ids"]) == {"r1", "r2"}


def test_common_area_excluded_from_unit() -> None:
    entities = [
        _entity("u1", "unit_boundary", (0, 0, 200, 200), "Unit A"),
        _entity("r1", "room", (20, 20, 80, 80), "Bedroom"),
        _entity("r2", "room", (40, 210, 120, 40), "Communal Space"),
    ]
    rels = derive_relationships(entities)
    contains = [r for r in rels if r["kind"] == "unit_contains_room"]
    assert {r["toId"] for r in contains} == {"r1"}
    units = units_from_entities(
        entities,
        rels,
        width_px=300,
        height_px=300,
        area_by_room={"r1": 12.0, "r2": 8.0},
    )
    assert units[0]["space_ids"] == ["r1"]


def test_hierarchy_build() -> None:
    from app.pipeline.hierarchy import build_building_hierarchy

    spaces = [
        {
            "id": "r1",
            "external_id": "Bedroom",
            "space_type": "bedroom",
            "unit_id": "u1",
            "area_m2": 12.0,
            "confidence": 0.9,
            "is_common": False,
        },
        {
            "id": "r2",
            "external_id": "Lobby",
            "space_type": "lobby",
            "unit_id": None,
            "area_m2": 20.0,
            "confidence": 0.9,
            "is_common": True,
        },
    ]
    units = [
        {
            "id": "u1",
            "external_id": "Unit A",
            "space_ids": ["r1"],
            "area_m2": 12.0,
            "confidence": 0.9,
            "review_required": False,
        }
    ]
    tree = build_building_hierarchy(
        analysis_id="a1",
        project_id="p1",
        source_file_name="tower.pdf",
        pages=[{"id": "page-1", "page_number": 1, "is_floor_plan": True, "level_name": "Level 1"}],
        spaces=spaces,
        units=units,
        openings=[],
    )
    assert tree["floors"][0]["level_name"] == "Level 1"
    assert tree["floors"][0]["common_area_ids"] == ["r2"]
    assert tree["units"][0]["room_ids"] == ["r1"]
    assert tree["rooms"][1]["is_common"] is True
