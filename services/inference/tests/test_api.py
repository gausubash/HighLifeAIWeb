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


def test_studio_dataset_lives_on_disk(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HIGHLIFE_STUDIO_DIR", str(tmp_path))
    from io import BytesIO

    from PIL import Image

    created = client.post("/v1/studio/datasets", json={"name": "Local", "task": "segment"})
    assert created.status_code == 200
    dataset_id = created.json()["id"]
    buf = BytesIO()
    Image.new("RGB", (8, 6), (240, 240, 240)).save(buf, format="PNG")
    added = client.post(
        f"/v1/studio/datasets/{dataset_id}/pages",
        data={"sourceName": "plan.pdf", "pageNumber": "1"},
        files={"file": ("page.png", buf.getvalue(), "image/png")},
    )
    assert added.status_code == 200
    listed = client.get("/v1/studio/datasets")
    assert listed.status_code == 200
    assert listed.json()["datasets"][0]["image_count"] == 1


def test_studio_train_needs_labels(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HIGHLIFE_STUDIO_DIR", str(tmp_path))
    created = client.post("/v1/studio/datasets", json={"name": "Empty", "task": "segment"})
    dataset_id = created.json()["id"]
    res = client.post("/v1/studio/train", json={"datasetId": dataset_id})
    assert res.status_code == 400


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


def test_geometry_extract_composes(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.yolo.predict import DetectedRegion

    def fake_extract(image_bytes, **kwargs):
        region = DetectedRegion(
            id="geo-1",
            type="room",
            label="Bedroom",
            confidence=1,
            polygon=[(0, 0), (10, 0), (10, 10), (0, 10)],
            bbox=(0, 0, 10, 10),
            attributes={"extractMethod": "wall_bounded", "unitLabel": "Unit 37"},
        )
        return [region], 10, 10, None

    monkeypatch.setattr("app.api.extract_from_image", fake_extract)
    from io import BytesIO

    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (8, 6), (240, 240, 240)).save(buf, format="PNG")
    res = client.post(
        "/v1/geometry/extract",
        data={"originalWidth": "10", "originalHeight": "10"},
        files={"file": ("page.png", buf.getvalue(), "image/png")},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["modelId"] == "geometry:wall_bounded"
    assert body["regions"][0]["attributes"]["extractMethod"] == "wall_bounded"
