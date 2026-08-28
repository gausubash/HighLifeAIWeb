from __future__ import annotations

from pathlib import Path

import pytest

from app.config import Settings
from app.detect_catalog import (
    default_detect_model,
    detect_model_token,
    list_detect_models,
    parse_detect_model,
)


def test_parse_detect_model_studio() -> None:
    assert parse_detect_model("studio:abc-123") == ("abc-123", None, None)
    assert parse_detect_model("wall:mitunet") == (None, "mitunet", None)
    assert parse_detect_model("layout:greenmap") == (None, None, "greenmap")


def test_detect_model_token() -> None:
    assert detect_model_token(studio_id="x") == "studio:x"
    assert detect_model_token(wall_backend="yolo") == "wall:yolo"


def test_list_detect_models_includes_builtin(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    weights = tmp_path / "yolo_walls_obb.pt"
    weights.write_bytes(b"x" * 1000)
    monkeypatch.setenv("WALL_BACKEND", "yolo")
    monkeypatch.setenv("YOLO_WALL_WEIGHTS", str(weights))
    monkeypatch.setenv("USE_LAYOUT_DETECTOR", "false")
    monkeypatch.setenv("USE_ROOM_DETECTOR", "false")
    from app.config import get_settings

    get_settings.cache_clear()
    models = list_detect_models(get_settings())
    ids = {str(m["id"]) for m in models}
    assert "wall:yolo" in ids
    assert "wall:mitunet" in ids


def test_default_detect_model_prefers_active_studio(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from app.studio import local_store as store

    monkeypatch.setattr(store, "studio_root", lambda: tmp_path)
    (tmp_path / "models").mkdir(parents=True)
    model_id = "11111111-1111-1111-1111-111111111111"
    model_dir = tmp_path / "models" / model_id
    model_dir.mkdir()
    (model_dir / "best.pt").write_bytes(b"pt")
    store._write_json(
        model_dir / "meta.json",
        {
            "id": model_id,
            "name": "Test seg",
            "task": "segment",
            "is_active": True,
            "class_names": ["Wall"],
        },
    )
    assert default_detect_model(Settings()) == f"studio:{model_id}"
