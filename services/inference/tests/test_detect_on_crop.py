"""Tests for detect_on_crop tiling gate."""

from __future__ import annotations

import numpy as np

from app.config import Settings
from app.yolo.tiling import detect_on_crop


def test_detect_on_crop_tiles_large_drawing_crop() -> None:
    tiled = {"n": 0}
    singles = {"n": 0}

    def predict_fn(rgb: np.ndarray) -> list:
        return []

    def fake_maybe_tiled(rgb, **kwargs) -> list:
        tiled["n"] += 1
        return []

    import app.yolo.tiling as tiling

    orig = tiling.maybe_tiled_detect
    tiling.maybe_tiled_detect = fake_maybe_tiled
    try:
        rgb = np.zeros((2000, 3000, 3), dtype=np.uint8)
        settings = Settings(DETECT_TILE_ENABLED=True)
        detect_on_crop(
            rgb,
            settings=settings,
            predict_fn=predict_fn,
            tile_size=1280,
            use_tiling=True,
        )
        assert tiled["n"] == 1
        detect_on_crop(
            rgb,
            settings=settings,
            predict_fn=predict_fn,
            tile_size=1280,
            use_tiling=False,
        )
    finally:
        tiling.maybe_tiled_detect = orig


def test_detect_on_crop_uses_model_imgsz_as_tile_gate() -> None:
    """Drawing-area tiling should start when crop exceeds model imgsz, not DETECT_TILE_MIN_SIDE."""
    calls: list[int] = []

    def fake_maybe_tiled(rgb, **kwargs) -> list:
        calls.append(int(kwargs.get("min_side", -1)))
        return []

    import app.yolo.tiling as tiling

    orig = tiling.maybe_tiled_detect
    tiling.maybe_tiled_detect = fake_maybe_tiled
    try:
        rgb = np.zeros((1000, 1200, 3), dtype=np.uint8)
        settings = Settings(DETECT_TILE_ENABLED=True, DETECT_TILE_MIN_SIDE=1280)
        detect_on_crop(
            rgb,
            settings=settings,
            predict_fn=lambda _rgb: [],
            tile_size=896,
            use_tiling=True,
        )
        assert calls == [896]
    finally:
        tiling.maybe_tiled_detect = orig


def test_detect_on_crop_single_pass_when_tiling_disabled() -> None:
    shapes: list[tuple[int, int]] = []

    def predict_fn(rgb: np.ndarray) -> list:
        shapes.append(rgb.shape[:2])
        return []

    rgb = np.zeros((2400, 3200, 3), dtype=np.uint8)
    settings = Settings(DETECT_TILE_ENABLED=True)
    detect_on_crop(
        rgb,
        settings=settings,
        predict_fn=predict_fn,
        tile_size=1280,
        use_tiling=False,
    )
    assert shapes == [(2400, 3200)]
