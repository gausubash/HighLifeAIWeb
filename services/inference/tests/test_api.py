"""HTTP API smoke tests (mock mode, no GPU)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api import app
from app.config import get_settings

client = TestClient(app)


@pytest.fixture(autouse=True)
def missing_local_weights(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("YOLO_WEIGHTS", "models/does-not-exist.pt")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_health() -> None:
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["service"] == "inference"
    assert data["run_mode"] in ("mock", "real")
    assert data["device"] in ("cpu", "cuda")
    assert data["yolo_ready"] is False
    assert data["room_ready"] is False
    assert data["wall_ready"] is True


def test_detect_without_detectors_is_503() -> None:
    from io import BytesIO

    from PIL import Image

    monkeypatch = pytest.MonkeyPatch()
    try:
        monkeypatch.setenv("USE_LAYOUT_DETECTOR", "false")
        monkeypatch.setenv("YOLO_WEIGHTS", "")
        monkeypatch.setenv("YOLO_ROOM_WEIGHTS", "models/does-not-exist.pt")
        monkeypatch.setenv("YOLO_WALL_WEIGHTS", "models/does-not-exist.pt")
        monkeypatch.setenv("WALL_BACKEND", "off")
        monkeypatch.setenv("ROBOFLOW_API_KEY", "")
        get_settings.cache_clear()

        buf = BytesIO()
        Image.new("RGB", (8, 6), (240, 240, 240)).save(buf, format="PNG")
        res = client.post(
            "/v1/detect",
            data={"originalWidth": "8", "originalHeight": "6"},
            files={"file": ("page.png", buf.getvalue(), "image/png")},
        )
        assert res.status_code == 503
        body = res.json()
        assert body["error"]["code"] == "DETECTORS_MISSING"
    finally:
        monkeypatch.undo()
        get_settings.cache_clear()


def test_analyze_mock() -> None:
    res = client.post(
        "/v1/analyze",
        json={
            "analysis_id": "api-test-analysis",
            "project_id": "api-test-project",
            "source_file_name": "fixture.pdf",
        },
    )
    assert res.status_code == 200
    payload = res.json()
    assert payload["ok"] is True
    assert payload["result"]["analysis_id"] == "api-test-analysis"
    assert payload["result"]["project_id"] == "api-test-project"
