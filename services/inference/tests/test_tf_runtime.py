"""TensorFlow runtime helpers for floorData Studio train."""

from __future__ import annotations

from pathlib import Path

from app.studio.tf_runtime import (
    DEFAULT_TF_VENV_PYTHON,
    resolve_tensorflow_python,
    tensorflow_runtime_available,
)


def test_default_tf_venv_path_points_under_inference():
    assert DEFAULT_TF_VENV_PYTHON.name.lower() in {"python.exe", "python"}
    assert ".venv-tf" in str(DEFAULT_TF_VENV_PYTHON)


def test_resolve_finds_local_venv_when_present():
    path = resolve_tensorflow_python()
    if DEFAULT_TF_VENV_PYTHON.is_file():
        assert path == DEFAULT_TF_VENV_PYTHON.resolve()
    else:
        assert path is None or isinstance(path, Path)


def test_runtime_available_when_venv_has_tensorflow():
    if not DEFAULT_TF_VENV_PYTHON.is_file():
        return
    # Probe may be slow the first time TensorFlow loads.
    assert tensorflow_runtime_available() is True
