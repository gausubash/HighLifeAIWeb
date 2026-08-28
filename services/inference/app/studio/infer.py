from __future__ import annotations

from pathlib import Path

from app.config import Settings, get_settings
from app.studio.dataset import is_floordata_base, is_mitunet_base, is_retinanet_base, is_torchvision_detect_base
from app.studio.floordata_train import detect_studio_floordata, is_studio_floordata_checkpoint
from app.studio.mitunet_train import detect_studio_mitunet, is_studio_mitunet_checkpoint
from app.studio.local_store import get_model, model_weights_path
from app.studio.retinanet import (
    detect_studio_torchvision_detector,
    is_studio_retinanet_checkpoint,
    is_studio_torchvision_detect_checkpoint,
)
from app.yolo.predict import DetectResult, DetectedRegion, _load_rgb, _predict_regions, _scale_region_to_original
from app.yolo.tiling import CancelFn, ProgressFn, detect_on_crop, map_progress_coords, stitch_wall_regions

_custom_model = None
_custom_model_path: str | None = None


def get_custom_model(weights_path: str):
    global _custom_model, _custom_model_path
    if _custom_model is None or _custom_model_path != weights_path:
        from ultralytics import YOLO

        _custom_model = YOLO(str(weights_path))
        _custom_model_path = weights_path
    return _custom_model


def _tag_studio(regions: list[DetectedRegion], model_id: str) -> list[DetectedRegion]:
    for region in regions:
        region.attributes["source"] = "studio"
        region.attributes["modelId"] = model_id
    return regions


def _run_on_drawing_crop(
    rgb,
    *,
    settings: Settings,
    drawing_crop: dict[str, float] | None,
    tile_size: int,
    predict_fn,
    on_progress: ProgressFn | None,
    cancel_check: CancelFn | None,
    stitch_walls: bool = False,
    sx: float = 1.0,
    sy: float = 1.0,
) -> tuple[list[DetectedRegion], str | None]:
    """Tile inside ``main_floorplan`` when provided; otherwise single-pass full page."""
    from app.yolo.crop import crop_page_normalized, full_page_crop, offset_bbox, offset_polygon

    warning: str | None = None
    client_crop = drawing_crop if isinstance(drawing_crop, dict) else None
    crop = None
    tile_in_drawing = False
    if client_crop:
        crop = crop_page_normalized(rgb, client_crop, pad_frac=settings.yolo_crop_pad)
        if crop:
            tile_in_drawing = True
    if crop is None:
        crop = full_page_crop(rgb)
        if client_crop is None:
            warning = (
                "No drawing area region — run layout detect or draw a drawing area box first. "
                "Ran detection on the full page (single pass, not tiled)."
            )

    progress = map_progress_coords(
        on_progress,
        dx=float(crop.x0),
        dy=float(crop.y0),
        sx=sx,
        sy=sy,
    )
    regions = detect_on_crop(
        crop.rgb,
        settings=settings,
        predict_fn=predict_fn,
        tile_size=tile_size,
        on_progress=progress,
        cancel_check=cancel_check,
        use_tiling=tile_in_drawing,
    )
    for region in regions:
        region.polygon = offset_polygon(region.polygon, crop.x0, crop.y0)
        region.bbox = offset_bbox(region.bbox, crop.x0, crop.y0)
    if stitch_walls:
        regions = stitch_wall_regions(regions)
    return regions, warning


def infer_custom_model(
    image_bytes: bytes,
    *,
    weights_path: str,
    model_id: str,
    original_width: int | None = None,
    original_height: int | None = None,
    settings: Settings | None = None,
    architecture: str | None = None,
    drawing_crop: dict[str, float] | None = None,
    on_progress: ProgressFn | None = None,
    cancel_check: CancelFn | None = None,
) -> DetectResult:
    settings = settings or get_settings()
    rgb = _load_rgb(image_bytes)
    src_h, src_w = rgb.shape[:2]
    target_w = original_width or src_w
    target_h = original_height or src_h
    sx = target_w / src_w if src_w else 1.0
    sy = target_h / src_h if src_h else 1.0
    warning: str | None = None

    weights = Path(weights_path)
    if (
        is_torchvision_detect_base(architecture or "")
        or is_studio_torchvision_detect_checkpoint(weights)
        or is_studio_retinanet_checkpoint(weights)
    ):
        tile = int(settings.yolo_wall_imgsz or settings.yolo_imgsz or settings.detect_tile_size or 640)

        def _predict(crop):
            regions, _names = detect_studio_torchvision_detector(
                crop,
                weights_path=weights,
                conf=settings.yolo_conf,
                imgsz=tile,
                device=settings.device.value,
            )
            return regions

        regions, crop_warning = _run_on_drawing_crop(
            rgb,
            settings=settings,
            drawing_crop=drawing_crop,
            tile_size=tile,
            predict_fn=_predict,
            on_progress=on_progress,
            cancel_check=cancel_check,
            sx=sx,
            sy=sy,
        )
        warning = crop_warning
        if abs(sx - 1) > 1e-6 or abs(sy - 1) > 1e-6:
            regions = [_scale_region_to_original(region, sx, sy) for region in regions]
        _tag_studio(regions, model_id)
        return DetectResult(
            model_id=model_id,
            model_version=weights.name,
            width_px=target_w,
            height_px=target_h,
            regions=regions,
            warning=warning,
            device=settings.device.value,
        )

    if is_floordata_base(architecture or "") or is_studio_floordata_checkpoint(weights):
        tile = int(settings.floordata_imgsz or settings.detect_tile_size or 512)
        conf = float(settings.floordata_threshold)

        def _predict(crop):
            regions, _names, _framework = detect_studio_floordata(
                crop,
                weights_path=weights,
                conf=conf,
                imgsz=tile,
            )
            return regions

        regions, crop_warning = _run_on_drawing_crop(
            rgb,
            settings=settings,
            drawing_crop=drawing_crop,
            tile_size=tile,
            predict_fn=_predict,
            on_progress=on_progress,
            cancel_check=cancel_check,
            stitch_walls=True,
            sx=sx,
            sy=sy,
        )
        warning = crop_warning
        if abs(sx - 1) > 1e-6 or abs(sy - 1) > 1e-6:
            regions = [_scale_region_to_original(region, sx, sy) for region in regions]
        _tag_studio(regions, model_id)
        return DetectResult(
            model_id=model_id,
            model_version=weights.name,
            width_px=target_w,
            height_px=target_h,
            regions=regions,
            warning=warning,
            device=settings.device.value,
        )

    if is_mitunet_base(architecture or "") or is_studio_mitunet_checkpoint(weights):
        tile = int(settings.mitunet_wall_imgsz or settings.detect_tile_size or 512)
        conf = float(settings.mitunet_wall_threshold)

        def _predict(crop):
            regions, _names = detect_studio_mitunet(
                crop,
                weights_path=weights,
                conf=conf,
                imgsz=tile,
                device=settings.device.value,
            )
            return regions

        regions, crop_warning = _run_on_drawing_crop(
            rgb,
            settings=settings,
            drawing_crop=drawing_crop,
            tile_size=tile,
            predict_fn=_predict,
            on_progress=on_progress,
            cancel_check=cancel_check,
            stitch_walls=True,
            sx=sx,
            sy=sy,
        )
        warning = crop_warning
        if abs(sx - 1) > 1e-6 or abs(sy - 1) > 1e-6:
            regions = [_scale_region_to_original(region, sx, sy) for region in regions]
        _tag_studio(regions, model_id)
        return DetectResult(
            model_id=model_id,
            model_version=weights.name,
            width_px=target_w,
            height_px=target_h,
            regions=regions,
            warning=warning,
            device=settings.device.value,
        )

    model = get_custom_model(weights_path)
    imgsz = int(settings.yolo_imgsz if settings.yolo_imgsz else settings.detect_tile_size or 640)

    def _predict(crop):
        return _predict_regions(
            model,
            crop,
            imgsz=imgsz,
            conf=settings.yolo_conf,
            device=settings.device.value,
        )

    regions, crop_warning = _run_on_drawing_crop(
        rgb,
        settings=settings,
        drawing_crop=drawing_crop,
        tile_size=imgsz,
        predict_fn=_predict,
        on_progress=on_progress,
        cancel_check=cancel_check,
        sx=sx,
        sy=sy,
    )
    warning = crop_warning
    if abs(sx - 1) > 1e-6 or abs(sy - 1) > 1e-6:
        regions = [_scale_region_to_original(region, sx, sy) for region in regions]
    _tag_studio(regions, model_id)
    return DetectResult(
        model_id=model_id,
        model_version=str(weights_path).rsplit("/", 1)[-1],
        width_px=target_w,
        height_px=target_h,
        regions=regions,
        warning=warning,
        device=settings.device.value,
    )


def infer_local_studio_model(
    *,
    model_id: str,
    image_bytes: bytes,
    original_width: int | None = None,
    original_height: int | None = None,
    drawing_crop: dict[str, float] | None = None,
    on_progress: ProgressFn | None = None,
    cancel_check: CancelFn | None = None,
) -> DetectResult:
    model = get_model(model_id)
    weights = model_weights_path(model_id)
    return infer_custom_model(
        image_bytes,
        weights_path=str(weights),
        model_id=model_id,
        original_width=original_width,
        original_height=original_height,
        architecture=str(model.get("architecture") or ""),
        drawing_crop=drawing_crop,
        on_progress=on_progress,
        cancel_check=cancel_check,
    )


def infer_studio_model(
    auth,
    *,
    model_id: str,
    image_bytes: bytes,
    original_width: int | None = None,
    original_height: int | None = None,
) -> DetectResult:
    return infer_local_studio_model(
        model_id=model_id,
        image_bytes=image_bytes,
        original_width=original_width,
        original_height=original_height,
    )
