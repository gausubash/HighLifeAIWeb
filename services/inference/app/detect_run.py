"""Shared detect execution for POST /v1/detect and /v1/detect/stream."""

from __future__ import annotations

from typing import Any

from fastapi.responses import JSONResponse

from app.config import Settings, get_settings
from app.detect_catalog import parse_detect_model, room_backend_from_token, opening_backend_from_token
from app.detect_options import wall_infer_overrides
from app.yolo.predict import DetectResult, DetectedRegion, detect_page_regions, detect_ready, layout_weights_source, room_yolo_ready, yolo_ready
from app.yolo.tiling import CancelFn, ProgressFn


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
    wall_overrides: dict[str, Any] | None = None,
) -> tuple[str | None, Settings] | JSONResponse:
    """Return (studio_id, settings) or an error JSONResponse."""
    settings = get_settings()
    token = (detect_model or model_id or "").strip() or None
    studio_id, wall_backend, layout_backend, detect_task = parse_detect_model(token)
    if model_id and not studio_id and not detect_model:
        studio_id = model_id.strip()

    if studio_id:
        if wall_overrides:
            settings = settings.model_copy(update=wall_overrides)
        return studio_id, settings

    req_settings: Settings = settings
    if detect_task == "layout" or layout_backend:
        if not yolo_ready(settings):
            return _error(
                503,
                "YOLO_WEIGHTS_MISSING",
                "Layout detector weights are missing. Run "
                "scripts/prefetch_layout.py or set YOLO_WEIGHTS to the Hugging Face URL.",
                {"weights": layout_weights_source(settings)},
            )
        req_settings = settings.model_copy(
            update={"use_layout_detector": True, "layout_only": True, "detect_task": "layout"},
        )
        if wall_overrides:
            req_settings = req_settings.model_copy(update=wall_overrides)
        return None, req_settings

    if detect_task == "structural":
        from app.yolo.roboflow import roboflow_floorplan_seg_ready

        if not roboflow_floorplan_seg_ready(settings):
            return _error(
                503,
                "ROBOFLOW_FLOORPLAN_SEG_MISSING",
                "Roboflow floorplan segmentation needs ROBOFLOW_API_KEY or cached weights. "
                "Run scripts/prefetch_roboflow_floorplan_seg.py.",
            )
        req_settings = settings.model_copy(
            update={
                "detect_task": "structural",
                "use_room_detector": False,
                "use_layout_detector": False,
                "layout_only": False,
                "wall_backend": "none",
            },
        )
        if wall_overrides:
            req_settings = req_settings.model_copy(update=wall_overrides)
        return None, req_settings

    if detect_task in {"rooms", "objects", "openings"}:
        room_backend = room_backend_from_token(token)
        if room_backend == "roboflow":
            from app.yolo.roboflow import roboflow_room_ready

            if detect_task in {"objects", "openings"}:
                return _error(
                    400,
                    "DETECT_NOT_WIRED",
                    "room:roboflow is a room-segmentation model. "
                    "Use opening:architect or object:architect for doors, windows, stairs, and lifts.",
                )
            if not roboflow_room_ready(settings):
                return _error(
                    503,
                    "ROBOFLOW_API_KEY_MISSING",
                    "Roboflow room segmentation needs ROBOFLOW_API_KEY "
                    "(or cached weights for floorplan-9fxye).",
                )
            req_settings = settings.model_copy(
                update={
                    "detect_task": "rooms",
                    "room_backend": "roboflow",
                    "use_room_detector": False,
                    "use_layout_detector": False,
                    "layout_only": False,
                    "wall_backend": "none",
                },
            )
            if wall_overrides:
                req_settings = req_settings.model_copy(update=wall_overrides)
            return None, req_settings
        if not room_yolo_ready(settings):
            return _error(
                503,
                "ROOM_WEIGHTS_MISSING",
                "Architect YOLO weights are missing. Run scripts/prefetch_architect.py, "
                "place models/architect_floorplan.pt, or set YOLO_ROOM_WEIGHTS.",
            )
        req_settings = settings.model_copy(
            update={
                "detect_task": detect_task,
                "room_backend": "architect",
                "use_room_detector": True,
                "use_layout_detector": False,
                "layout_only": False,
                "wall_backend": "none",
            },
        )
        if wall_overrides:
            req_settings = req_settings.model_copy(update=wall_overrides)
        return None, req_settings

    if detect_task == "north":
        return _error(
            501,
            "DETECT_NOT_WIRED",
            "North-arrow heading needs a Studio OBB or keypoint model. "
            "Train a north_arrow pose dataset (tip/base) and pick that studio: model on the North card.",
        )

    if wall_backend == "roboflow":
        from app.yolo.roboflow import roboflow_wall_ready

        if not roboflow_wall_ready(settings):
            return _error(
                503,
                "ROBOFLOW_API_KEY_MISSING",
                "ArchVision wall detect needs ROBOFLOW_API_KEY "
                "(or cached weights for archvision_wall_detect).",
            )
        req_settings = settings.model_copy(
            update={
                "detect_task": "walls",
                "wall_backend": "roboflow",
                "use_room_detector": False,
                "layout_only": False,
            },
        )
        if wall_overrides:
            req_settings = req_settings.model_copy(update=wall_overrides)
        return None, req_settings

    if wall_backend and wall_backend not in {"mitunet"}:
        return _error(
            501,
            "DETECT_NOT_WIRED",
            f"Wall detection supports MitUNet, Roboflow wall/seg, or ArchVision (got {wall_backend!r}). "
            "Use wall:mitunet, wall:roboflow, or structural:roboflow-seg.",
        )

    req_settings = settings.model_copy(
        update={
            "detect_task": "walls",
            "wall_backend": "mitunet",
            "use_room_detector": False,
            "layout_only": False,
        },
    )

    if wall_overrides:
        req_settings = req_settings.model_copy(update=wall_overrides)

    if not detect_ready(req_settings):
        return _error(
            503,
            "DETECTORS_MISSING",
            "MitUNet wall weights are not configured. Download mitunet_walls.pth.",
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
    tile_walls: str = "",
    wall_imgsz: str = "",
    wall_threshold: str = "",
    tile_overlap: str = "",
    on_progress: ProgressFn | None = None,
    cancel_check: CancelFn | None = None,
) -> DetectResult | JSONResponse:
    overrides = wall_infer_overrides(
        tile_walls=tile_walls,
        wall_imgsz=wall_imgsz,
        wall_threshold=wall_threshold,
        tile_overlap=tile_overlap,
    )
    prepared = prepare_detect_settings(
        detect_model=detect_model,
        model_id=model_id,
        wall_overrides=overrides or None,
    )
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
                settings=req_settings,
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
