from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app.yolo.crop import (
    clamp_crop_xyxy,
    crop_page,
    full_page_crop,
    is_drawing_area,
    offset_polygon,
    scale_crop_px,
    select_drawing_areas,
)
from app.yolo.predict import DetectedRegion, room_enabled, room_yolo_ready
from app.config import Settings


@dataclass
class _Region:
    type: str
    label: str
    confidence: float
    bbox: tuple[float, float, float, float]
    attributes: dict[str, object] = field(default_factory=dict)


def test_is_drawing_area() -> None:
    assert is_drawing_area(_Region("main_floorplan", "Drawing area", 0.9, (0, 0, 10, 10)))
    assert is_drawing_area(_Region("other", "drawing_area", 0.9, (0, 0, 10, 10)))
    assert not is_drawing_area(_Region("title_block", "Title block", 0.99, (0, 0, 4, 2)))


def test_select_drawing_areas_prefers_large_confident() -> None:
    small = _Region("main_floorplan", "Drawing area", 0.99, (0, 0, 10, 10))
    large = _Region("main_floorplan", "Drawing area", 0.80, (0, 0, 80, 60))
    title = _Region("title_block", "Title block", 1.0, (0, 0, 20, 5))
    picked = select_drawing_areas([title, small, large])
    assert picked == [large, small]


def test_clamp_crop_pads_and_stays_on_page() -> None:
    box = clamp_crop_xyxy(200, 160, (10.0, 10.0, 40.0, 30.0), pad_frac=0.1, min_pad=2)
    assert box == (6, 6, 54, 44)

    edge = clamp_crop_xyxy(50, 50, (0.0, 0.0, 20.0, 20.0), pad_frac=0.5, min_pad=8)
    assert edge == (0, 0, 30, 30)


def test_crop_page_and_map_room_back_to_sheet() -> None:
    rgb = np.zeros((80, 100, 3), dtype=np.uint8)
    rgb[20:60, 10:70] = 200
    crop = crop_page(rgb, (10.0, 20.0, 60.0, 40.0), pad_frac=0.0, min_pad=0)
    assert crop is not None
    assert crop.x0 == 10
    assert crop.y0 == 20
    assert crop.width == 60
    assert crop.height == 40
    assert crop.rgb.shape[:2] == (40, 60)
    assert crop.to_page(3.0, 4.0) == (13.0, 24.0)
    assert offset_polygon([(3.0, 4.0), (8.0, 9.0)], crop.x0, crop.y0) == [(13.0, 24.0), (18.0, 29.0)]


def test_full_page_crop_is_identity() -> None:
    rgb = np.zeros((80, 100, 3), dtype=np.uint8)
    crop = full_page_crop(rgb)
    assert crop.x0 == 0
    assert crop.y0 == 0
    assert crop.width == 100
    assert crop.height == 80
    assert crop.rgb.shape[:2] == (80, 100)


def test_scale_crop_px_to_original_page() -> None:
    assert scale_crop_px({"x": 10, "y": 20, "width": 40, "height": 30}, 2.0, 0.5) == {
        "x": 20.0,
        "y": 10.0,
        "width": 80.0,
        "height": 15.0,
    }


def test_room_detector_disabled_by_default(monkeypatch) -> None:
    monkeypatch.delenv("USE_ROOM_DETECTOR", raising=False)
    monkeypatch.delenv("YOLO_ROOM_WEIGHTS", raising=False)
    settings = Settings(_env_file=None)
    assert settings.use_room_detector is False
    assert settings.yolo_room_weights == ""
    assert room_yolo_ready(settings) is False
    assert room_enabled(settings) is False


def test_detected_region_crop_attribute_roundtrip() -> None:
    region = DetectedRegion(
        id="da-1",
        type="main_floorplan",
        label="Drawing area",
        confidence=0.9,
        polygon=[(10, 20), (70, 20), (70, 60), (10, 60)],
        bbox=(10, 20, 60, 40),
        attributes={"cropPx": {"x": 10, "y": 20, "width": 60, "height": 40}},
    )
    assert is_drawing_area(region)
    assert select_drawing_areas([region]) == [region]
