from app.mock import mock_apartment_scene_graph
from app.schemas.scene_graph import FloorPlanSceneGraph


def test_mock_graph_validates() -> None:
    graph = mock_apartment_scene_graph(
        project_id="p",
        plan_document_id="d",
        page_id="pg",
        analysis_run_id="r",
    )
    parsed = FloorPlanSceneGraph.model_validate(graph.model_dump(by_alias=True))
    assert parsed.calibration is not None
    assert parsed.calibration.method == "manual_two_point"
    rooms = [e for e in parsed.entities if e.type == "room"]
    assert len(rooms) == 2
    assert all(e.id and e.status and e.created_at for e in parsed.entities)
