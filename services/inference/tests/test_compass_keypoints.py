from __future__ import annotations

from app.yolo.classes import entity_type_for
from app.yolo.compass_keypoints import (
    coco_visibility,
    extract_ultralytics_keypoints,
    heading_from_keypoints,
    parse_prediction_keypoints,
)
from app.yolo.predict import regions_from_ultralytics
from app.yolo.roboflow import predictions_to_regions


class _Arr:
    def __init__(self, data: list) -> None:
        import numpy as np

        self._data = np.asarray(data)

    def cpu(self) -> "_Arr":
        return self

    def numpy(self):
        return self._data


class _Boxes:
    def __init__(self) -> None:
        self.cls = _Arr([0])
        self.conf = _Arr([0.93])
        self.xyxy = _Arr([[8.0, 8.0, 12.0, 40.0]])

    def __len__(self) -> int:
        return 1


class _Keypoints:
    def __init__(self) -> None:
        self.xy = _Arr([[[10.0, 38.0], [10.0, 10.0]]])
        self.conf = _Arr([[0.91, 0.88]])
        self.data = _Arr([[[10.0, 38.0, 2.0], [10.0, 10.0, 1.0]]])

    def __len__(self) -> int:
        return 1


class _PoseResult:
    names = {0: "north_arrow"}
    kpt_names = ["base", "tip"]
    boxes = _Boxes()
    masks = None
    keypoints = _Keypoints()


def test_coco_visibility() -> None:
    assert coco_visibility(2) == "visible"
    assert coco_visibility(1) == "occluded"
    assert coco_visibility(0) == "not_labeled"
    assert coco_visibility("occluded") == "occluded"


def test_parse_roboflow_keypoints() -> None:
    keypoints = parse_prediction_keypoints(
        {
            "class": "compass",
            "keypoints": [
                {"class": "base", "x": 10, "y": 40, "visibility": 2, "confidence": 0.9},
                {"class": "tip", "x": 10, "y": 10, "visibility": 1, "confidence": 0.8},
            ],
        }
    )
    assert [k["name"] for k in keypoints] == ["tip", "base"]
    assert keypoints[0]["visibility"] == "occluded"
    heading = heading_from_keypoints(keypoints)
    assert heading is not None
    assert abs(heading[2] - 270.0) < 0.01


def test_predictions_to_regions_keeps_compass_keypoints() -> None:
    regions = predictions_to_regions(
        [
            {
                "class": "north arrow",
                "confidence": 0.9,
                "class_id": 0,
                "x": 10,
                "y": 24,
                "width": 4,
                "height": 32,
                "keypoints": [
                    {"class": "base", "x": 10, "y": 38, "visibility": "visible"},
                    {"class": "tip", "x": 10, "y": 10, "occluded": True},
                ],
            }
        ]
    )
    assert len(regions) == 1
    assert regions[0].type == "north_arrow"
    kpts = regions[0].attributes["keypoints"]
    assert {k["name"]: k["visibility"] for k in kpts} == {"tip": "occluded", "base": "visible"}
    assert abs(float(regions[0].attributes["headingDeg"]) - 270.0) < 0.01


def test_regions_from_ultralytics_pose_keypoints() -> None:
    regions = regions_from_ultralytics(
        _PoseResult(),
        src_w=100,
        src_h=80,
        target_w=200,
        target_h=160,
    )
    assert len(regions) == 1
    assert regions[0].type == "north_arrow"
    kpts = {k["name"]: k for k in regions[0].attributes["keypoints"]}
    assert kpts["base"]["x"] == 20.0
    assert kpts["base"]["y"] == 76.0
    assert kpts["tip"]["x"] == 20.0
    assert kpts["tip"]["y"] == 20.0
    assert kpts["tip"]["visibility"] == "occluded"
    extracted = extract_ultralytics_keypoints(_PoseResult(), 0, sx=1.0, sy=1.0)
    assert extracted[0]["name"] == "tip"


def test_entity_type_for_compass() -> None:
    assert entity_type_for("north_arrow") == "north_arrow"
    assert entity_type_for("North Arrow") == "north_arrow"
    assert entity_type_for("compass") == "north_arrow"
