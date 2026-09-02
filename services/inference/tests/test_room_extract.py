from __future__ import annotations

import numpy as np

from app.pipeline.room_extract import extract_wall_bounded_rooms
from app.yolo.predict import DetectedRegion


def test_splits_two_rooms_across_a_wall_bar() -> None:
    mask = np.zeros((60, 100), dtype=np.uint8)
    mask[:, 48:52] = 1
    rooms = extract_wall_bounded_rooms(
        width_px=100,
        height_px=60,
        wall_mask=mask,
        room_regions=[
            DetectedRegion(
                id="a",
                type="room",
                label="Bedroom",
                confidence=1,
                polygon=[(2, 2), (46, 2), (46, 58), (2, 58)],
                bbox=(2, 2, 44, 56),
            ),
            DetectedRegion(
                id="b",
                type="room",
                label="Bathroom",
                confidence=1,
                polygon=[(54, 2), (98, 2), (98, 58), (54, 58)],
                bbox=(54, 2, 44, 56),
            ),
        ],
    )
    labels = {r.label for r in rooms}
    assert "Bedroom" in labels
    assert "Bathroom" in labels
    for room in rooms:
        xs = [p[0] for p in room.polygon]
        if room.label == "Bedroom":
            assert max(xs) < 55
        if room.label == "Bathroom":
            assert min(xs) > 45


def test_rooms_stay_inside_their_unit() -> None:
    mask = np.zeros((60, 100), dtype=np.uint8)
    mask[:, 48:52] = 1
    mask[28:32, :48] = 1
    rooms = extract_wall_bounded_rooms(
        width_px=100,
        height_px=60,
        wall_mask=mask,
        unit_polygons=[
            {
                "id": "u37",
                "label": "Unit 37",
                "points": [{"x": 0, "y": 0}, {"x": 50, "y": 0}, {"x": 50, "y": 60}, {"x": 0, "y": 60}],
            },
            {
                "id": "u36",
                "label": "Unit 36",
                "points": [{"x": 50, "y": 0}, {"x": 100, "y": 0}, {"x": 100, "y": 60}, {"x": 50, "y": 60}],
            },
        ],
        room_regions=[
            DetectedRegion(
                id="bed",
                type="room",
                label="Bedroom",
                confidence=1,
                polygon=[(2, 2), (46, 2), (46, 26), (2, 26)],
                bbox=(2, 2, 44, 24),
            ),
            DetectedRegion(
                id="liv",
                type="room",
                label="Open Living",
                confidence=1,
                polygon=[(54, 4), (96, 4), (96, 56), (54, 56)],
                bbox=(54, 4, 42, 52),
            ),
        ],
    )
    by_unit = {}
    for room in rooms:
        by_unit.setdefault(room.attributes.get("unitLabel"), []).append(room.label)
    assert "Bedroom" in by_unit.get("Unit 37", [])
    assert "Open Living" in by_unit.get("Unit 36", [])
