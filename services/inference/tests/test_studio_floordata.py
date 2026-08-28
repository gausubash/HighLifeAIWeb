from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from app.studio.dataset import (
    DEEPLAB_BASE_ID,
    UNET_BASE_ID,
    assert_base_model,
    floordata_base_kind,
    is_deeplab_base,
    is_floordata_base,
    is_unet_floordata_base,
)
from app.studio.floordata_train import _yolo_to_mask
from app.studio.tf_runtime import tensorflow_in_process
from app.yolo.floordata import tensorflow_available


def test_floordata_base_ids() -> None:
    assert is_deeplab_base("wall:deeplab")
    assert is_unet_floordata_base("simple_walls_best.h5")
    assert is_floordata_base("unet_walls_best.h5")
    assert floordata_base_kind("deeplab_walls_best.h5") == "deeplab"
    assert floordata_base_kind("unet_walls_best.h5") == "unet"
    assert assert_base_model("segment", "deeplab") == DEEPLAB_BASE_ID
    assert assert_base_model("segment", "unet") == UNET_BASE_ID


def test_yolo_to_mask_box(tmp_path: Path) -> None:
    label = tmp_path / "a.txt"
    label.write_text("0 0.5 0.5 0.5 0.5\n", encoding="utf-8")
    mask = _yolo_to_mask(label, width=100, height=100, num_classes=2, out_size=64)
    assert mask.shape == (64, 64, 2)
    assert float(mask[..., 0].sum()) > 0


@pytest.mark.skipif(not tensorflow_in_process(), reason="TensorFlow not in-process")
def test_build_unet_forward() -> None:
    from app.studio.floordata_train import build_unet

    model = build_unet(128, 1)
    out = model.predict(np.zeros((1, 128, 128, 3), dtype=np.float32), verbose=0)
    assert out.shape == (1, 128, 128, 1)
