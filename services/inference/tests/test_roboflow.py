from __future__ import annotations

from app.yolo.roboflow import is_wall_region, predictions_to_regions, roboflow_ready
from app.config import Settings


def test_predictions_to_regions_polygon_and_box() -> None:
    regions = predictions_to_regions(
        [
            {
                "class": "wall",
                "confidence": 0.91,
                "class_id": 0,
                "points": [{"x": 10, "y": 20}, {"x": 40, "y": 20}, {"x": 40, "y": 28}, {"x": 10, "y": 28}],
            },
            {
                "class": "door",
                "confidence": 87,
                "x": 50,
                "y": 50,
                "width": 10,
                "height": 20,
            },
        ]
    )
    assert len(regions) == 2
    assert regions[0].type == "wall"
    assert regions[0].label == "Wall"
    assert regions[0].polygon[0] == (10.0, 20.0)
    assert is_wall_region(regions[0]) is True
    assert regions[1].type == "door"
    assert regions[1].confidence == 0.87
    assert is_wall_region(regions[1]) is False


def test_roboflow_ready_requires_api_key_or_local(monkeypatch) -> None:
    monkeypatch.delenv("ROBOFLOW_API_KEY", raising=False)
    monkeypatch.setattr("app.yolo.roboflow.resolve_roboflow_weights", lambda settings=None: None)
    settings = Settings(_env_file=None)
    assert roboflow_ready(settings) is False
    monkeypatch.setenv("ROBOFLOW_API_KEY", "rf_test")
    settings = Settings(_env_file=None)
    assert roboflow_ready(settings) is True
    assert settings.roboflow_model_id.startswith("floorplan-iculh")
