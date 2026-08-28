"""Unit tests for PaddleOCR text parsers (no paddle dependency)."""

from __future__ import annotations

from app.pipeline.paddle_ocr import (
    crop_rgb_normalized,
    parse_level_name,
    parse_unit_ids,
    pick_scale_from_lines,
    scale_ocr_line_boxes,
    sheet_meta_from_crop,
    sheet_meta_from_ocr_lines,
    upsample_rgb_for_ocr,
)


def test_parse_level_and_units() -> None:
    text = "TOWER A  LEVEL 02  UNIT 12B  SCALE 1:100 @ A1"
    assert parse_level_name(text) == "Level 02"
    assert parse_level_name("FIRST FLOOR PLAN") == "First Floor Plan"
    assert parse_level_name("Second Floor Plan") == "Second Floor Plan"
    assert "12B" in parse_unit_ids(text)
    assert "101" in parse_unit_ids("Unit 101 ")
    assert parse_unit_ids("UNIT PLAN") == []


def test_upsample_small_ocr_crop_to_paddle_default() -> None:
    import numpy as np

    rgb = np.zeros((240, 400, 3), dtype=np.uint8)
    out, scale = upsample_rgb_for_ocr(rgb, 960)
    assert scale == 960 / 400
    assert out.shape[1] == 960
    assert out.shape[0] == int(round(240 * scale))

    large = np.zeros((1200, 1600, 3), dtype=np.uint8)
    same, scale2 = upsample_rgb_for_ocr(large, 960)
    assert scale2 == 1.0
    assert same.shape[:2] == (1200, 1600)

    lines = [
        {
            "text": "SCALE",
            "confidence": 0.9,
            "bbox": [[10.0, 20.0], [50.0, 20.0], [50.0, 36.0], [10.0, 36.0]],
        }
    ]
    back = scale_ocr_line_boxes(lines, 2.0)
    assert back[0]["bbox"][0] == [5.0, 10.0]


def test_crop_rgb_normalized() -> None:
    import numpy as np

    rgb = np.zeros((100, 200, 3), dtype=np.uint8)
    rgb[80:, 140:] = 255
    crop, bounds = crop_rgb_normalized(rgb, {"x": 0.7, "y": 0.8, "width": 0.25, "height": 0.2})
    assert crop.shape[0] > 0 and crop.shape[1] > 0
    assert bounds["x0"] >= 140
    assert bounds["y0"] >= 80

    lines = [{"text": "SCALE 1:200 @ A3", "confidence": 0.9, "bbox": [[1.0, 2.0], [3.0, 2.0], [3.0, 4.0], [1.0, 4.0]]}]
    meta = sheet_meta_from_ocr_lines(lines)
    shifted = sheet_meta_from_crop(meta, crop_bounds=bounds, page_width=200, page_height=100)
    assert shifted["lines"][0]["bbox"][0][0] == bounds["x0"] + 1.0


def test_sheet_meta_from_lines() -> None:
    lines = [
        {"text": "GROUND FLOOR PLAN", "confidence": 0.95, "bbox": None},
        {"text": "SCALE 1:200 @ A3", "confidence": 0.9, "bbox": None},
        {"text": "UNIT 5A", "confidence": 0.88, "bbox": None},
    ]
    meta = sheet_meta_from_ocr_lines(lines)
    assert meta["provider"] == "paddleocr"
    assert meta["levelName"] == "Ground Floor Plan"
    assert meta["scaleText"] == "1:200 @ A3"
    assert "5A" in meta["unitIds"]
    assert meta["sheetType"] in {"ga", "unit"}


def test_pick_scale_prefers_title_block_line_over_room_noise() -> None:
    lines = [
        {"text": "BED 1", "confidence": 0.99, "bbox": None},
        {"text": "KITCHEN", "confidence": 0.98, "bbox": None},
        {"text": "LEVEL 03", "confidence": 0.92, "bbox": None},
        {"text": "SCALE 1:100 @ A1", "confidence": 0.9, "bbox": None},
    ]
    scale_text, paper = pick_scale_from_lines(lines)
    assert scale_text == "1:100 @ A1"
    assert paper == "A1"
    meta = sheet_meta_from_ocr_lines(lines)
    assert meta["scaleText"] == "1:100 @ A1"
    assert meta["levelName"] == "Level 03"


def test_pick_scale_merges_ratio_and_paper_from_separate_lines() -> None:
    lines = [
        {"text": "LEVEL 02", "confidence": 0.95, "bbox": None},
        {"text": "SCALE 1:100", "confidence": 0.92, "bbox": None},
        {"text": "@ A1", "confidence": 0.9, "bbox": None},
    ]
    scale_text, paper = pick_scale_from_lines(lines)
    assert scale_text == "1:100 @ A1"
    assert paper == "A1"
    meta = sheet_meta_from_ocr_lines(lines)
    assert meta["scaleText"] == "1:100 @ A1"
    assert meta["paperSize"] == "A1"


def test_pick_scale_ignores_bare_paper_without_at() -> None:
    lines = [
        {"text": "LEVEL 02", "confidence": 0.95, "bbox": None},
        {"text": "SCALE 1:100", "confidence": 0.92, "bbox": None},
        {"text": "A2", "confidence": 0.9, "bbox": None},
    ]
    scale_text, paper = pick_scale_from_lines(lines)
    assert scale_text == "1:100"
    assert paper is None


def test_pick_scale_clusters_by_bbox_not_line_order() -> None:
    def box(x: float, y: float, w: float = 40.0, h: float = 12.0) -> list[list[float]]:
        return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]

    lines = [
        {"text": "SCALE", "confidence": 0.96, "bbox": box(800, 900)},
        {"text": "FIRST FLOOR PLAN", "confidence": 0.99, "bbox": box(40, 40, 180, 16)},
        {"text": "STORE", "confidence": 0.94, "bbox": box(120, 300)},
        {"text": "BED 1", "confidence": 0.93, "bbox": box(200, 300)},
        {"text": "1:100", "confidence": 0.95, "bbox": box(850, 900)},
        {"text": "ROBE", "confidence": 0.9, "bbox": box(280, 300)},
        {"text": "@ A1", "confidence": 0.92, "bbox": box(910, 900)},
    ]
    scale_text, paper = pick_scale_from_lines(lines)
    assert scale_text == "1:100 @ A1"
    assert paper == "A1"


def test_pick_scale_ignores_spatially_distant_paper() -> None:
    def box(x: float, y: float, w: float = 40.0, h: float = 12.0) -> list[list[float]]:
        return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]

    lines = [
        {"text": "SCALE", "confidence": 0.96, "bbox": box(800, 900)},
        {"text": "1:100", "confidence": 0.95, "bbox": box(850, 900)},
        {"text": "@ A3", "confidence": 0.92, "bbox": box(40, 40)},
    ]
    scale_text, paper = pick_scale_from_lines(lines)
    assert scale_text == "1:100"
    assert paper is None


def test_pick_scale_merges_ratio_and_at_paper_size() -> None:
    lines = [
        {"text": "ABC ARCHITECTS", "confidence": 0.95, "bbox": None},
        {"text": "GROUND FLOOR PLAN", "confidence": 0.95, "bbox": None},
        {"text": "SCALE: 1:100", "confidence": 0.92, "bbox": None},
        {"text": "@ A1", "confidence": 0.9, "bbox": None},
        {"text": "DATE 2026-08-28", "confidence": 0.88, "bbox": None},
        {"text": "PROJECT 1024", "confidence": 0.85, "bbox": None},
    ]
    scale_text, paper = pick_scale_from_lines(lines)
    assert scale_text == "1:100 @ A1"
    assert paper == "A1"
    meta = sheet_meta_from_ocr_lines(lines)
    assert meta["scaleText"] == "1:100 @ A1"
    assert meta.get("paperSize") == "A1"
