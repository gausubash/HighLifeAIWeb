from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from app.config import Settings
from app.yolo.mitunet import (
    MITUNET_MODEL_ID,
    mask_to_polygons,
    mitunet_ready,
    resolve_mitunet_weights,
)


def test_mask_to_polygons_rectangle() -> None:
    mask = np.zeros((40, 50), dtype=np.uint8)
    mask[10:20, 5:25] = 1
    polygons = mask_to_polygons(mask, min_area=8, max_vertices=20)
    assert len(polygons) == 1
    xs = polygons[0][:, 0]
    ys = polygons[0][:, 1]
    assert xs.min() <= 5.5
    assert xs.max() >= 24.0
    assert ys.min() <= 10.5
    assert ys.max() >= 19.0


def test_mask_to_polygons_empty() -> None:
    assert mask_to_polygons(np.zeros((16, 16), dtype=np.uint8)) == []


def test_mitunet_ready_remote_url() -> None:
    settings = Settings(
        _env_file=None,
        wall_backend="mitunet",
        mitunet_wall_weights="https://example.com/mitunet.pth",
    )
    assert mitunet_ready(settings) is True
    assert MITUNET_MODEL_ID.startswith("mitunet")


def test_mitunet_ready_disabled_by_backend() -> None:
    settings = Settings(
        _env_file=None,
        wall_backend="yolo",
        mitunet_wall_weights="https://example.com/mitunet.pth",
    )
    assert mitunet_ready(settings) is False


def test_mitunet_ready_missing_local(tmp_path: Path) -> None:
    settings = Settings(
        _env_file=None,
        wall_backend="mitunet",
        mitunet_wall_weights=str(tmp_path / "missing.pth"),
    )
    assert mitunet_ready(settings) is False


def test_resolve_uses_downloaded_cache(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    cache = tmp_path / "mitunet_walls.pth"
    cache.write_bytes(b"x" * 200_000_001)
    monkeypatch.setattr("app.yolo.mitunet.default_mitunet_path", lambda: cache)
    settings = Settings(
        _env_file=None,
        mitunet_wall_weights="https://example.com/mitunet.pth",
    )
    assert resolve_mitunet_weights(settings) == str(cache)
