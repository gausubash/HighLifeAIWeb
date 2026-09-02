"""Tests for tiled drawing-area OCR merge logic."""

from __future__ import annotations

from app.pipeline.paddle_ocr_tiling import (
    merge_ocr_lines,
    ocr_lines_near_duplicate,
    offset_ocr_line,
    run_tiled_ocr_lines,
)


def _line(text: str, x: float, y: float, conf: float = 0.9) -> dict:
    return {
        "text": text,
        "confidence": conf,
        "bbox": [[x, y], [x + 40, y], [x + 40, y + 12], [x, y + 12]],
    }


def test_offset_ocr_line_shifts_bbox() -> None:
    shifted = offset_ocr_line(_line("BED 1", 10, 20), 100, 200)
    assert shifted["bbox"][0] == [110.0, 220.0]


def test_merge_drops_overlap_duplicates() -> None:
    a = _line("KITCHEN", 500, 500, 0.95)
    b = _line("KITCHEN", 508, 503, 0.7)
    c = _line("BATH", 800, 500, 0.8)
    merged = merge_ocr_lines([a, b, c])
    assert len(merged) == 2
    texts = {row["text"] for row in merged}
    assert texts == {"KITCHEN", "BATH"}
    kitchen = next(row for row in merged if row["text"] == "KITCHEN")
    assert kitchen["confidence"] == 0.95


def test_ocr_lines_near_duplicate_ignores_different_text() -> None:
    assert not ocr_lines_near_duplicate(_line("BED 1", 0, 0), _line("BED 2", 2, 2))


def test_merge_drops_wide_label_shifted_across_tiles() -> None:
    """Overlap copies of a long word can sit 30px apart — taller-than-wide thresh missed them."""
    a = _box_line("KITCHEN", 100, 50, 160, 16, conf=0.9)
    b = _box_line("KITCHEN.", 128, 52, 160, 16, conf=0.7)
    merged = merge_ocr_lines([a, b])
    assert len(merged) == 1
    assert merged[0]["text"] == "KITCHEN"


def test_merge_keeps_two_identical_labels_far_apart() -> None:
    a = _box_line("WC", 40, 80, 28, 14)
    b = _box_line("WC", 420, 80, 28, 14)
    merged = merge_ocr_lines([a, b])
    assert len(merged) == 2


def _box_line(text: str, x: float, y: float, w: float, h: float = 14, conf: float = 0.9, cuts: list[str] | None = None) -> dict:
    row = {
        "text": text,
        "confidence": conf,
        "bbox": [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
    }
    if cuts:
        row["cutEdges"] = cuts
    return row


def test_merge_keeps_full_reading_over_truncated_overlap() -> None:
    full = _box_line("BEDROOM 1", 100, 40, 120, conf=0.84)
    stub = _box_line("BEDRO", 100, 41, 55, conf=0.91, cuts=["right"])
    merged = merge_ocr_lines([full, stub])
    assert len(merged) == 1
    assert merged[0]["text"] == "BEDROOM 1"
    assert "cutEdges" not in merged[0]


def test_merge_stitches_cut_fragments_across_tile_seam() -> None:
    left = _box_line("BEDROO", 80, 50, 70, cuts=["right"])
    right = _box_line("ROOM 1", 142, 51, 72, cuts=["left"])
    merged = merge_ocr_lines([left, right])
    assert len(merged) == 1
    assert merged[0]["text"] == "BEDROOM 1"


def test_merge_drops_repeat_when_one_text_contains_the_other() -> None:
    a = _box_line("UNIT 101", 200, 80, 110, conf=0.8)
    b = _box_line("UNIT 10", 200, 81, 80, conf=0.95)
    merged = merge_ocr_lines([a, b])
    assert len(merged) == 1
    assert merged[0]["text"] == "UNIT 101"


def test_merge_keeps_separate_labels_on_the_same_row() -> None:
    a = _box_line("BED 1", 40, 60, 50)
    b = _box_line("BATH 1", 140, 60, 55)
    merged = merge_ocr_lines([a, b])
    texts = {row["text"] for row in merged}
    assert texts == {"BED 1", "BATH 1"}


def test_merge_keeps_stacked_scale_lines() -> None:
    a = _box_line("SCALE", 10, 10, 60, 12)
    b = _box_line("1:100", 10, 28, 50, 12)
    merged = merge_ocr_lines([a, b])
    texts = {row["text"] for row in merged}
    assert texts == {"SCALE", "1:100"}


def test_run_tiled_ocr_lines_splits_large_crop() -> None:
    import numpy as np

    calls: list[tuple[int, int]] = []

    def fake_ocr(crop: np.ndarray) -> list[dict]:
        calls.append((crop.shape[1], crop.shape[0]))
        return [_line("LABEL", 12, 8)]

    rgb = np.zeros((2000, 3000, 3), dtype=np.uint8)
    lines, meta = run_tiled_ocr_lines(
        rgb,
        run_ocr=fake_ocr,
        tile_size=1280,
        overlap=0.25,
        min_side=1280,
    )
    assert meta["tiled"] is True
    assert meta["tileCount"] > 1
    assert len(calls) == meta["tileCount"]
    assert len(lines) >= 1


def test_run_tiled_ocr_lines_skips_small_crop() -> None:
    import numpy as np

    def fake_ocr(crop: np.ndarray) -> list[dict]:
        return [_line("ONLY", 4, 4)]

    rgb = np.zeros((400, 500, 3), dtype=np.uint8)
    lines, meta = run_tiled_ocr_lines(
        rgb,
        run_ocr=fake_ocr,
        tile_size=960,
        overlap=0.25,
        min_side=960,
    )
    assert meta["tiled"] is False
    assert meta["tileCount"] == 1
    assert len(lines) == 1


def test_run_tiled_ocr_lines_tiles_when_larger_than_paddle_default() -> None:
    import numpy as np

    calls: list[tuple[int, int]] = []

    def fake_ocr(crop: np.ndarray) -> list[dict]:
        calls.append((crop.shape[1], crop.shape[0]))
        return [_line("LABEL", 12, 8)]

    rgb = np.zeros((1100, 1400, 3), dtype=np.uint8)
    lines, meta = run_tiled_ocr_lines(
        rgb,
        run_ocr=fake_ocr,
        tile_size=960,
        overlap=0.25,
        min_side=960,
    )
    assert meta["tiled"] is True
    assert meta["tileCount"] > 1
    assert len(calls) == meta["tileCount"]
    assert len(lines) >= 1


def test_run_tiled_ocr_lines_emits_tile_progress() -> None:
    import numpy as np

    events: list[tuple[str, dict]] = []

    def fake_ocr(crop: np.ndarray) -> list[dict]:
        return [_line("LABEL", 12, 8)]

    rgb = np.zeros((1100, 1400, 3), dtype=np.uint8)
    run_tiled_ocr_lines(
        rgb,
        run_ocr=fake_ocr,
        tile_size=960,
        overlap=0.25,
        min_side=960,
        on_progress=lambda kind, payload: events.append((kind, payload)),
    )
    kinds = [kind for kind, _ in events]
    assert kinds[0] == "meta"
    assert "tile_start" in kinds
    assert "tile_done" in kinds
    starts = [payload for kind, payload in events if kind == "tile_start"]
    assert starts[0]["index"] == 1
    assert starts[0]["total"] == starts[-1]["total"]
    assert starts[0]["tile"]["width"] > 0
    assert starts[0]["tile"]["height"] > 0


def test_ocr_tile_wanted_defaults_and_settings() -> None:
    from app.config import Settings
    from app.pipeline.paddle_ocr import ocr_tile_wanted

    on = Settings(_env_file=None, PADDLE_OCR_TILE_ENABLED=True)
    off = Settings(_env_file=None, PADDLE_OCR_TILE_ENABLED=False)

    assert ocr_tile_wanted(on, "default", backend="classic") is False
    assert ocr_tile_wanted(on, "dense", backend="classic") is False
    assert ocr_tile_wanted(off, "dense", backend="classic") is False

    assert ocr_tile_wanted(on, "default", {"tile_title_block": True}, backend="classic") is True
    assert ocr_tile_wanted(on, "dense", {"tile_drawing": False}, backend="classic") is False
    assert ocr_tile_wanted(off, "dense", {"tile_drawing": True}, backend="classic") is True
    assert ocr_tile_wanted(on, "dense", {"tile": False}, backend="classic") is False
    assert ocr_tile_wanted(on, "dense", {"tile_drawing": True, "backend": "vl"}, backend="vl") is False
