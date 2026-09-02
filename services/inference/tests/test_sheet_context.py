import numpy as np

from app.config import Settings
from app.pipeline.sheet_context import extract_sheet_context


def test_http_vlm_does_not_upload_floorplan_by_default(monkeypatch) -> None:
    def boom(*_args, **_kwargs):
        raise AssertionError("floor-plan rasters must not POST to VLM_API_URL")

    monkeypatch.setattr("app.pipeline.sheet_context._call_vlm_http", boom)
    rgb = np.zeros((16, 16, 3), dtype=np.uint8)
    settings = Settings.model_validate(
        {
            "VLM_ENABLED": True,
            "VLM_PROVIDER": "http",
            "VLM_API_URL": "https://example.invalid/v1/chat/completions",
            "VLM_API_KEY": "test",
            "VLM_ALLOW_REMOTE_IMAGES": False,
            "PADDLE_OCR_ENABLED": False,
        }
    )
    meta = extract_sheet_context(rgb, settings=settings)
    assert meta.get("provider") != "vlm_http"
