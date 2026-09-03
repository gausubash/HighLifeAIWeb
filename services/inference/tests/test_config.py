"""Configuration and settings tests."""

import pytest

from app.config import Device, RunMode, Settings, get_settings, resolve_device, torch_cuda_available


def test_default_settings_mock_mode(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("YOLO_WEIGHTS", raising=False)
    monkeypatch.delenv("DEVICE", raising=False)
    settings = Settings(_env_file=None)
    assert settings.run_mode == RunMode.MOCK
    assert settings.device in (Device.CPU, Device.CUDA)
    assert settings.yolo_weights == ""
    assert settings.use_layout_detector is False
    assert settings.use_room_detector is False
    assert settings.yolo_room_weights == ""
    assert settings.yolo_imgsz == 1280


def test_settings_from_env_real_mode(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("RUN_MODE", "real")
    monkeypatch.setenv("DEVICE", "cpu")
    get_settings.cache_clear()
    settings = get_settings()
    assert settings.run_mode == RunMode.REAL
    assert settings.device == Device.CPU
    get_settings.cache_clear()


def test_device_cuda_when_available(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DEVICE", "cuda")
    monkeypatch.setattr("app.config.torch_cuda_available", lambda: True)
    settings = Settings(_env_file=None)
    assert settings.device == Device.CUDA


def test_device_cuda_falls_back_to_cpu(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DEVICE", "cuda")
    monkeypatch.setattr("app.config.torch_cuda_available", lambda: False)
    settings = Settings(_env_file=None)
    assert settings.device == Device.CPU


def test_device_auto_picks_cuda(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DEVICE", "auto")
    monkeypatch.setattr("app.config.torch_cuda_available", lambda: True)
    settings = Settings(_env_file=None)
    assert settings.device == Device.CUDA


def test_device_auto_picks_cpu(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DEVICE", "auto")
    monkeypatch.setattr("app.config.torch_cuda_available", lambda: False)
    settings = Settings(_env_file=None)
    assert settings.device == Device.CPU


def test_resolve_device_helper():
    assert resolve_device(Device.CPU) == Device.CPU
    assert resolve_device(Device.AUTO) in (Device.CPU, Device.CUDA)


def test_get_settings_cached():
    get_settings.cache_clear()
    a = get_settings()
    b = get_settings()
    assert a is b
    get_settings.cache_clear()


def test_torch_cuda_available_is_bool():
    assert isinstance(torch_cuda_available(), bool)
