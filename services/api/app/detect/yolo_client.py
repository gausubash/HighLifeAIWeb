from __future__ import annotations

from io import BytesIO

import httpx
from PIL import Image

from app.config import get_settings
from app.detect.pipeline import DetectResult, DetectedRegion
from app.errors import ApiError


def detect_via_yolo_inference(
    image_bytes: bytes,
    *,
    original_width: int | None,
    original_height: int | None,
) -> DetectResult:
    settings = get_settings()
    base = settings.inference_api_url.rstrip("/")
    files = {"file": ("page.png", image_bytes, "image/png")}
    data: dict[str, str] = {}
    if original_width:
        data["originalWidth"] = str(original_width)
    if original_height:
        data["originalHeight"] = str(original_height)

    try:
        with httpx.Client(timeout=300.0) as client:
            res = client.post(f"{base}/v1/detect", files=files, data=data)
    except httpx.RequestError as exc:
        raise ApiError(
            "INFERENCE_UNAVAILABLE",
            "YOLO inference is not running. Start it on port 8000: "
            "cd services/inference && uvicorn app.api:app --host 127.0.0.1 --port 8000",
            status_code=503,
            details={"reason": str(exc), "url": base},
        ) from exc

    payload = res.json()
    if res.status_code >= 400:
        err = payload.get("error") if isinstance(payload, dict) else None
        message = (
            err.get("message")
            if isinstance(err, dict)
            else payload.get("detail") if isinstance(payload, dict)
            else "YOLO detect failed."
        )
        raise ApiError(
            (err or {}).get("code", "YOLO_DETECT_FAILED") if isinstance(err, dict) else "YOLO_DETECT_FAILED",
            str(message),
            status_code=res.status_code,
            details=err.get("details") if isinstance(err, dict) else {},
        )

    regions = [
        DetectedRegion(
            id=item["id"],
            type=item["type"],
            label=item["label"],
            confidence=float(item["confidence"]),
            polygon=[(p["x"], p["y"]) for p in item["polygonPx"]],
            bbox=(
                item["bboxPx"]["x"],
                item["bboxPx"]["y"],
                item["bboxPx"]["width"],
                item["bboxPx"]["height"],
            ),
            attributes=item.get("attributes") or {},
        )
        for item in payload.get("regions") or []
    ]
    width = int(payload.get("widthPx") or original_width or 0)
    height = int(payload.get("heightPx") or original_height or 0)
    if width < 1 or height < 1:
        image = Image.open(BytesIO(image_bytes))
        width, height = image.size

    return DetectResult(
        model_id=str(payload.get("modelId") or "yolo11x-blueprint-layout-detector"),
        model_version=str(payload.get("modelVersion") or "unknown"),
        width_px=width,
        height_px=height,
        regions=regions,
        warning=payload.get("warning"),
    )
