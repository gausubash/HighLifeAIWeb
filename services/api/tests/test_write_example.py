from pathlib import Path

from app.schemas.scene_graph import FloorPlanSceneGraph


def test_committed_example_validates() -> None:
    dest = Path(__file__).resolve().parents[1] / "examples" / "apartment_two_rooms.json"
    parsed = FloorPlanSceneGraph.model_validate_json(dest.read_text(encoding="utf-8"))
    assert parsed.schema_version == "1.0.0"
    assert parsed.calibration and parsed.calibration.mm_per_pixel == 5.0
    assert len([e for e in parsed.entities if e.type == "room"]) == 2
