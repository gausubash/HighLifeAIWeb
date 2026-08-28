"""TensorFlow .venv-tf infer wiring."""

from __future__ import annotations

import numpy as np

from app.studio.tf_runtime import (
    DEFAULT_TF_VENV_PYTHON,
    predict_mask_with_runtime,
    tensorflow_runtime_available,
)
from app.yolo.floordata import tensorflow_available


def test_floordata_tf_available_via_venv() -> None:
    assert DEFAULT_TF_VENV_PYTHON.is_file()
    assert tensorflow_runtime_available() is True
    assert tensorflow_available() is True


def test_predict_mask_worker_rejects_missing_weights(tmp_path) -> None:
    rgb = np.zeros((32, 32, 3), dtype=np.uint8)
    missing = tmp_path / "nope.h5"
    try:
        predict_mask_with_runtime(rgb, weights_path=missing, imgsz=64)
        raised = False
    except Exception:
        raised = True
    assert raised
