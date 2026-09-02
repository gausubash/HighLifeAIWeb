from __future__ import annotations

from app.yolo.roboflow import (
    is_opening_region,
    is_wall_region,
    normalize_roboflow_model_id,
    predictions_to_regions,
    roboflow_floorplan_seg_ready,
    roboflow_ready,
    roboflow_room_ready,
    roboflow_wall_ready,
)
from app.config import Settings
from app.yolo.classes import entity_type_for, room_type_for


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
    assert is_opening_region(regions[1]) is True


def test_floorplan_seg_labels() -> None:
    regions = predictions_to_regions(
        [
            {"class": "Wall", "confidence": 0.9, "x": 10, "y": 10, "width": 40, "height": 4},
            {"class": "Door", "confidence": 0.8, "x": 20, "y": 20, "width": 6, "height": 10},
            {"class": "Window", "confidence": 0.7, "x": 30, "y": 30, "width": 8, "height": 4},
        ]
    )
    assert len(regions) == 3
    assert is_wall_region(regions[0])
    assert is_opening_region(regions[1])
    assert is_opening_region(regions[2])
    assert not is_wall_region(regions[1])


def test_roboflow_floorplan_seg_ready_needs_api_key(monkeypatch) -> None:
    monkeypatch.delenv("ROBOFLOW_API_KEY", raising=False)
    monkeypatch.setattr(
        "app.yolo.roboflow.resolve_roboflow_floorplan_seg_weights",
        lambda settings=None: None,
    )
    settings = Settings(_env_file=None)
    assert roboflow_floorplan_seg_ready(settings) is False
    monkeypatch.setenv("ROBOFLOW_API_KEY", "rf_test")
    settings = Settings(_env_file=None)
    assert roboflow_floorplan_seg_ready(settings) is True


def test_roboflow_ready_requires_api_key_or_local(monkeypatch) -> None:
    monkeypatch.delenv("ROBOFLOW_API_KEY", raising=False)
    monkeypatch.setattr("app.yolo.roboflow.resolve_roboflow_weights", lambda settings=None: None)
    settings = Settings(_env_file=None)
    assert roboflow_ready(settings) is False
    monkeypatch.setenv("ROBOFLOW_API_KEY", "rf_test")
    settings = Settings(_env_file=None)
    assert roboflow_ready(settings) is True
    assert settings.roboflow_model_id.startswith("floorplan-iculh")


def test_normalize_roboflow_model_id() -> None:
    assert normalize_roboflow_model_id("floorplan-cvjp0/floorplan-9fxye/1") == "floorplan-9fxye/1"
    assert normalize_roboflow_model_id("floorplan-9fxye/1") == "floorplan-9fxye/1"
    assert (
        normalize_roboflow_model_id("walldetection-iekzl/archvision_wall_detect/1")
        == "archvision_wall_detect/1"
    )


def test_roboflow_wall_ready_needs_api_key(monkeypatch) -> None:
    monkeypatch.delenv("ROBOFLOW_API_KEY", raising=False)
    monkeypatch.setattr("app.yolo.roboflow.resolve_roboflow_wall_weights", lambda settings=None: None)
    settings = Settings(_env_file=None)
    assert roboflow_wall_ready(settings) is False
    monkeypatch.setenv("ROBOFLOW_API_KEY", "rf_test")
    settings = Settings(_env_file=None)
    assert roboflow_wall_ready(settings) is True
    assert settings.roboflow_wall_model_id.startswith("archvision_wall_detect")


def test_roboflow_room_ready_needs_api_key(monkeypatch) -> None:
    monkeypatch.delenv("ROBOFLOW_API_KEY", raising=False)
    monkeypatch.setattr("app.yolo.roboflow.resolve_roboflow_room_weights", lambda settings=None: None)
    settings = Settings(_env_file=None)
    assert roboflow_room_ready(settings) is False
    monkeypatch.setenv("ROBOFLOW_API_KEY", "rf_test")
    settings = Settings(_env_file=None)
    assert roboflow_room_ready(settings) is True


def test_office_room_labels_map_to_rooms() -> None:
    assert entity_type_for("conference") == "room"
    assert entity_type_for("Rest-room") == "room"
    assert entity_type_for("company-area") == "room"
    assert room_type_for("Rest-room") == "bathroom"
    assert room_type_for("reception") == "lobby"
    assert room_type_for("company-area") == "office"
