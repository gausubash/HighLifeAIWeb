"""Configuration and settings tests."""

import os

import pytest

from app.config import Device, RunMode, Settings, get_settings


def test_default_settings_mock_mode():
    settings = Settings(_env_file=None)
    assert settings.run_mode == RunMode.MOCK
    assert settings.device == Device.CPU


def test_settings_from_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("RUN_MODE", "real")
    monkeypatch.setenv("DEVICE", "cuda")
    get_settings.cache_clear()
    settings = get_settings()
    assert settings.run_mode == RunMode.REAL
    assert settings.device == Device.CUDA
    get_settings.cache_clear()


def test_get_settings_cached():
    get_settings.cache_clear()
    a = get_settings()
    b = get_settings()
    assert a is b
    get_settings.cache_clear()
