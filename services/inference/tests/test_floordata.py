from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from app.config import Settings
from app.yolo.floordata import floordata_ready, tensorflow_available
from app.yolo.wall_registry import resolve_legacy_wall_weights_for_backend


def test_unet_path_prefers_alias(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    models = tmp_path / "models"
    models.mkdir()
    alias = models / "simple_walls_best.h5"
    alias.write_bytes(b"fake")
    monkeypatch.setattr("app.yolo.wall_registry.inference_root", lambda: tmp_path)
    settings = Settings(FLOORDATA_UNET_WEIGHTS="")
    path = resolve_legacy_wall_weights_for_backend(settings, "unet_floordata")
    assert Path(path).name == "simple_walls_best.h5"


def test_floordata_ready_false_without_weights(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.yolo.wall_registry.inference_root", lambda: tmp_path)
    settings = Settings(
        WALL_BACKEND="deeplab",
        FLOORDATA_DEEPLAB_WEIGHTS=str(tmp_path / "missing.h5"),
    )
    assert floordata_ready(settings, "deeplab") is False


def test_detect_catalog_marks_floordata_runnable_when_tf_present() -> None:
    from app.detect_catalog import _wall_backend_runnable

    assert _wall_backend_runnable("deeplab") is tensorflow_available()
    assert _wall_backend_runnable("unet_floordata") is tensorflow_available()
    assert _wall_backend_runnable("mitunet") is True


@pytest.mark.skipif(not tensorflow_available(), reason="TensorFlow runtime not available")
def test_floordata_predict_requires_real_h5() -> None:
    root = Path(__file__).resolve().parents[1]
    weights = root / "models" / "deeplab_walls_best.h5"
    if not weights.is_file():
        pytest.skip("deeplab_walls_best.h5 not on disk")
    from app.yolo.floordata import detect_floordata_walls

    settings = Settings(
        WALL_BACKEND="deeplab",
        FLOORDATA_DEEPLAB_WEIGHTS=str(weights),
        FLOORDATA_WALL_IMGSZ=128,
    )
    rgb = np.full((128, 128, 3), 240, dtype=np.uint8)
    regions = detect_floordata_walls(rgb, settings=settings, backend="deeplab")
    assert isinstance(regions, list)
