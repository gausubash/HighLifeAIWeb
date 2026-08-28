"""Shared detect execution for POST /v1/detect and /v1/detect/stream."""

from __future__ import annotations

from typing import Any

from fastapi.responses import JSONResponse

from app.config import Settings, get_settings
from app.detect_catalog import _wall_backend_runnable, parse_detect_model
from app.yolo.predict import DetectResult, DetectedRegion, detect_page_regions, detect_ready, layout_weights_source, yolo_ready
from app.yolo.tiling import CancelFn, ProgressFn
from app.yolo.wall_registry import FLOORDATA_WALL_BACKENDS


def _error(status: int, code: str, message: str, details: dict | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message": message, "details": details or {}}},
    )


def serialize_region(region: DetectedRegion) -> dict[str, Any]:
    x, y, w, h = region.bbox
    return {
        "id": region.id,
        "type": region.type,
        "label": region.label,
        "confidence": region.confidence,
        "polygonPx": [{"x": px, "y": py} for px, py in region.polygon],
        "bboxPx": {"x": x, "y": y, "width": w, "height": h},
        "attributes": dict(region.attributes or {}),
    }


def serialize_detect_result(result: DetectResult) -> dict[str, Any]:
    return {
        "modelId": result.model_id,
        "modelVersion": result.model_version,
        "widthPx": result.width_px,
        "heightPx": result.height_px,
        "warning": result.warning,
        "device": result.device,
        "regions": [serialize_region(region) for region in result.regions],
    }


def prepare_detect_settings(
    *,
    detect_model: str | None,
    model_id: str | None,
) -> tuple[str | None, Settings] | JSONResponse:
    """Return (studio_id, settings) or an error JSONResponse."""
    settings = get_settings()
    token = (detect_model or model_id or "").strip() or None
    studio_id, wall_backend, layout_backend = parse_detect_model(token)
    if model_id and not studio_id and not detect_model:
        studio_id = model_id.strip()

    if studio_id:
        return studio_id, settings

    req_settings: Settings = settings
    if layout_backend:
        if not yolo_ready(settings):
            return _error(
                503,
                "YOLO_WEIGHTS_MISSING",
                "Layout detector weights are missing. Run "
                "scripts/prefetch_layout.py or set YOLO_WEIGHTS to the Hugging Face URL.",
                {"weights": layout_weights_source(settings)},
            )
        req_settings = settings.model_copy(
            update={"use_layout_detector": True, "layout_only": True},
        )
        return None, req_settings

    if wall_backend:
        if wall_backend == "roboflow":
            from app.yolo.roboflow import roboflow_ready

            if not roboflow_ready(settings):
                return _error(
                    503,
                    "ROBOFLOW_MISSING",
                    "Roboflow weights are not ready. Run "
                    ".venv-tf\\Scripts\\python.exe scripts/prefetch_roboflow.py "
                    "or set ROBOFLOW_API_KEY for cloud detect.",
                )
            req_settings = settings.model_copy(update={"wall_backend": "roboflow"})
        else:
            if not _wall_backend_runnable(wall_backend):
                if wall_backend in FLOORDATA_WALL_BACKENDS:
                    from app.studio.tf_runtime import tensorflow_runtime_hint

                    return _error(
                        501,
                        "TENSORFLOW_MISSING",
                        f"Wall backend {wall_backend!r} needs TensorFlow. "
                        + tensorflow_runtime_hint(),
                    )
                return _error(
                    501,
                    "DETECT_NOT_WIRED",
                    f"Wall backend {wall_backend!r} is not wired into /v1/detect yet. "
                    "Use mitunet, yolo, a MMDet model, or a Studio fine-tune.",
                )
            req_settings = settings.model_copy(update={"wall_backend": wall_backend})

    if req_settings.use_layout_detector and not yolo_ready(req_settings):
        return _error(
            503,
            "YOLO_WEIGHTS_MISSING",
            "Layout detector is enabled but YOLO_WEIGHTS is missing. Run "
            "scripts/prefetch_layout.py or set YOLO_WEIGHTS.",
            {"weights": layout_weights_source(req_settings)},
        )
    if not detect_ready(req_settings):
        return _error(
            503,
            "DETECTORS_MISSING",
            "No wall detector is configured for the selected model. "
            "Download weights or pick another model in Detect.",
        )
    return None, req_settings


def run_detect(
    image_bytes: bytes,
    *,
    original_width: int | None,
    original_height: int | None,
    detect_model: str | None,
    model_id: str | None,
    drawing_crop: dict[str, float] | None = None,
    on_progress: ProgressFn | None = None,
    cancel_check: CancelFn | None = None,
) -> DetectResult | JSONResponse:
    prepared = prepare_detect_settings(detect_model=detect_model, model_id=model_id)
    if isinstance(prepared, JSONResponse):
        return prepared
    studio_id, req_settings = prepared

    if studio_id:
        from app.studio.infer import infer_local_studio_model
        from app.studio.local_store import StudioStoreError

        try:
            return infer_local_studio_model(
                model_id=studio_id,
                image_bytes=image_bytes,
                original_width=original_width,
                original_height=original_height,
                drawing_crop=drawing_crop,
                on_progress=on_progress,
                cancel_check=cancel_check,
            )
        except StudioStoreError as exc:
            return _error(exc.status if exc.status < 500 else 422, "STUDIO_INFER", str(exc))

    return detect_page_regions(
        image_bytes,
        original_width=original_width,
        original_height=original_height,
        settings=req_settings,
        drawing_crop=drawing_crop,
        on_progress=on_progress,
        cancel_check=cancel_check,
    )
