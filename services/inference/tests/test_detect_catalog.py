from __future__ import annotations

import pytest

from app.config import Settings
from app.detect_catalog import (
    default_detect_model,
    detect_model_token,
    list_detect_models,
    parse_detect_model,
)
from app.yolo.classes import region_matches_detect_task


def test_region_matches_detect_task() -> None:
    assert region_matches_detect_task("wall", "walls")
    assert not region_matches_detect_task("room", "walls")
    assert region_matches_detect_task("room", "rooms")
    assert region_matches_detect_task("unit_boundary", "rooms")
    assert region_matches_detect_task("door", "openings")
    assert region_matches_detect_task("window", "openings")
    assert not region_matches_detect_task("door", "rooms")
    assert region_matches_detect_task("door", "objects") is False
    assert region_matches_detect_task("stair", "objects")
    assert region_matches_detect_task("door", "structural")
    assert region_matches_detect_task("window", "structural")
    assert not region_matches_detect_task("room", "structural")


def test_parse_detect_model_studio() -> None:
    assert parse_detect_model("studio:abc-123") == ("abc-123", None, None, "studio")
    assert parse_detect_model("wall:mitunet") == (None, "mitunet", None, "walls")
    assert parse_detect_model("wall:roboflow") == (None, "roboflow", None, "walls")
    assert parse_detect_model("wall:roboflow-seg") == (None, None, None, "structural")
    assert parse_detect_model("opening:roboflow-seg") == (None, None, None, "structural")
    assert parse_detect_model("structural:roboflow-seg") == (None, None, None, "structural")
    assert parse_detect_model("layout:greenmap") == (None, None, "greenmap", "layout")
    assert parse_detect_model("room:architect") == (None, None, None, "rooms")
    assert parse_detect_model("room:roboflow") == (None, None, None, "rooms")
    assert parse_detect_model("object:architect") == (None, None, None, "objects")
    assert parse_detect_model("opening:architect") == (None, None, None, "openings")
    assert parse_detect_model("symbol:north") == (None, None, None, "north")
    from app.detect_catalog import opening_backend_from_token, room_backend_from_token

    assert room_backend_from_token("room:roboflow") == "roboflow"
    assert room_backend_from_token("room:architect") == "architect"
    assert opening_backend_from_token("opening:roboflow-seg") == "roboflow-seg"
    assert opening_backend_from_token("opening:architect") == "architect"


def test_detect_model_token() -> None:
    assert detect_model_token(studio_id="x") == "studio:x"
    assert detect_model_token(wall_backend="mitunet") == "wall:mitunet"
    assert detect_model_token(detect_task="structural") == "structural:roboflow-seg"


def test_list_detect_models_includes_archvision_walls(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WALL_BACKEND", "mitunet")
    monkeypatch.setenv("USE_LAYOUT_DETECTOR", "false")
    monkeypatch.setenv("USE_ROOM_DETECTOR", "false")
    from app.config import get_settings

    get_settings.cache_clear()
    models = list_detect_models(get_settings())
    ids = {str(m["id"]) for m in models}
    assert "wall:mitunet" in ids
    assert "wall:roboflow" in ids
    assert "wall:yolo" not in ids
    assert "wall:deeplab" not in ids
    assert "room:architect" in ids
    assert "room:roboflow" in ids
    assert "object:architect" in ids
    assert "opening:architect" in ids
    assert "structural:roboflow-seg" in ids
    assert "opening:roboflow-seg" not in ids
    assert "wall:roboflow-seg" not in ids
    assert "symbol:north" in ids
    wall_builtins = [m for m in models if str(m["id"]).startswith("wall:") and m["kind"] == "builtin"]
    assert [m["id"] for m in wall_builtins] == ["wall:mitunet", "wall:roboflow"]


def test_list_detect_models_skips_studio_without_weights(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.studio import local_store
    import app.detect_catalog as catalog

    broken_id = "4cb8d44a-3894-42c3-bbdd-5219beb873f4"

    monkeypatch.setattr(
        catalog,
        "list_models",
        lambda: [{"id": broken_id, "name": "Broken", "task": "detect", "category": "object_detection"}],
    )
    monkeypatch.setattr(
        catalog,
        "model_weights_path",
        lambda model_id: (_ for _ in ()).throw(local_store.StudioStoreError("missing", 404))
        if model_id == broken_id
        else local_store.model_weights_path(model_id),
    )

    models = list_detect_models(Settings())
    studio = [m for m in models if str(m.get("id", "")) == f"studio:{broken_id}"]
    assert len(studio) == 1
    assert studio[0]["ready"] is False
    assert studio[0]["runnable"] is False


def test_default_detect_model_is_not_legacy_wall_backend() -> None:
    token = default_detect_model(Settings())
    assert not token.startswith("wall:yolo")
    assert "deeplab" not in token
    ids = {str(m["id"]) for m in list_detect_models(Settings())}
    assert "wall:yolo" not in ids
    assert "wall:mitunet" in ids


def test_prepare_detect_settings_roboflow_rooms(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ROBOFLOW_API_KEY", "rf_test")
    from app.config import get_settings
    from app.detect_run import prepare_detect_settings

    get_settings.cache_clear()
    studio_id, settings = prepare_detect_settings(
        detect_model="room:roboflow",
        model_id=None,
    )
    assert studio_id is None
    assert settings.detect_task == "rooms"
    assert settings.room_backend == "roboflow"


def test_prepare_detect_settings_structural(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ROBOFLOW_API_KEY", "rf_test")
    from app.config import get_settings
    from app.detect_run import prepare_detect_settings

    get_settings.cache_clear()
    studio_id, settings = prepare_detect_settings(
        detect_model="structural:roboflow-seg",
        model_id=None,
    )
    assert studio_id is None
    assert settings.detect_task == "structural"


def test_prepare_detect_settings_roboflow_walls(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ROBOFLOW_API_KEY", "rf_test")
    from app.config import get_settings
    from app.detect_run import prepare_detect_settings

    get_settings.cache_clear()
    studio_id, settings = prepare_detect_settings(
        detect_model="wall:roboflow",
        model_id=None,
    )
    assert studio_id is None
    assert settings.detect_task == "walls"
    assert settings.wall_backend == "roboflow"
    assert settings.roboflow_wall_model_id.startswith("archvision_wall_detect")
