"""Tests for scale conversion — ported from BuildPro."""

import math

from app.pipeline.blueprint import (
    compute_calibration_from_scale_declaration,
    parse_scale_and_paper,
    parse_scale_ratio,
)
from app.pipeline.scale_converter import (
    ScaleConverter,
    format_scale_declaration,
    infer_paper_size_from_pixels,
    normalize_paper_code,
    parse_paper_from_text,
)


def test_parse_scale_and_paper():
    assert parse_scale_and_paper("DRAWING SCALE 1:200 @ A3") == (200, "A3")
    assert parse_scale_and_paper("scale 1:100 @ a4") == (100, "A4")
    assert parse_scale_and_paper("1:200@A3") == (200, "A3")
    assert parse_scale_and_paper("SCALE l:200 @ A3") == (200, "A3")
    assert parse_scale_and_paper("Scale 1.200 @ A 3") == (200, "A3")
    assert parse_scale_and_paper("SCALE: 1:100 @ A1") == (100, "A1")
    assert parse_scale_and_paper("1:100 @ A1") == (100, "A1")
    assert parse_scale_and_paper("SCALE 1:10O @ A1") == (100, "A1")
    assert normalize_paper_code("A3J") == "A3"


def test_parse_scale_ratio_ocr_noise():
    assert parse_scale_ratio("DRAWING SCALE 1:100") == 100
    assert parse_scale_ratio("Scale l:200") == 200
    assert parse_scale_ratio("SCALE 1:10O") == 100
    assert parse_scale_ratio("SCALE 1 : 100") == 100
    assert parse_scale_ratio("SCALE: 1/100") == 100
    assert parse_scale_ratio("1 TO 100") == 100


def test_parse_paper_from_text():
    assert parse_paper_from_text("@ A1") == "A1"
    assert parse_paper_from_text("DRAWN @ A3") == "A3"
    assert parse_paper_from_text("@A1") == "A1"
    assert parse_paper_from_text("© A2") == "A2"
    assert parse_paper_from_text("@ ISO A1") == "A1"
    assert parse_paper_from_text("PROJECT A1") is None
    assert parse_paper_from_text("A2") is None
    assert format_scale_declaration(100, "A1") == "1:100 @ A1"


def test_effective_scale_a3_to_a4():
    converter = ScaleConverter(200, "A3", dpi=300)
    effective = converter.get_effective_scale("A4")
    assert abs(effective - 200 * math.sqrt(2)) < 0.5


def test_infer_a4_from_pixels_300dpi():
    code = infer_paper_size_from_pixels(2480, 3508, 300)
    assert code == "A4"


def test_calibration_from_scale_declaration():
    cal = compute_calibration_from_scale_declaration(
        2480, 3508, 300, 200, "A3", unit="m"
    )
    assert cal is not None
    assert cal.pixels_per_unit > 0
    assert "200" in cal.scale_label
