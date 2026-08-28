"""Tests for PDF region rendering helpers."""

from __future__ import annotations

from app.studio.link_path import normalized_crop_to_pdfium_crop


def test_normalized_crop_to_pdfium_crop_top_left_origin() -> None:
    crop = {"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.1}
    left, bottom, right, top = normalized_crop_to_pdfium_crop(crop, 1000.0, 800.0)
    assert left == 100.0
    assert right == 400.0
    assert top == 640.0
    assert bottom == 560.0
