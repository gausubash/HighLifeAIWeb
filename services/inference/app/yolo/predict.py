from __future__ import annotations

from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from uuid import uuid4

import numpy as np
from PIL import Image

from app.config import Settings, get_settings
from app.yolo.classes import CLASS_NAMES, display_label, entity_type_for, room_type_for
from app.yolo.crop import (
    crop_page,
    crop_page_normalized,
    full_page_crop,
    offset_bbox,
    offset_polygon,
    scale_bbox,
    scale_crop_px,
    scale_polygon,
    select_drawing_areas,
)

HF_LAYOUT_WEIGHTS = (
    "https://huggingface.co/GreenMap/yolo11x-blueprint-layout-detector/resolve/main/yolo_layout.pt"
)
HF_LAYOUT_MODEL_ID = "yolo11x-blueprint-layout-detector"
HF_ROOM_WEIGHTS = "https://huggingface.co/SamirShabani/Architect/resolve/main/best.pt"
HF_ROOM_HUB = "SamirShabani/Architect"
HF_ROOM_MODEL_ID = "architect-floorplan-cad"
HF_WALL_WEIGHTS = (
    "https://huggingface.co/GreenMap/yolo11x-blueprint-wall-detector/resolve/main/yolo_walls_obb.pt"
)
HF_WALL_HUB = "GreenMap/yolo11x-blueprint-wall-detector"
HF_WALL_MODEL_ID = "yolo11x-blueprint-wall-detector"

MAX_POLYGON_VERTICES = 80


@dataclass
class DetectedRegion:
    id: str
    type: str
    label: str
    confidence: float
    polygon: list[tuple[float, float]]
    bbox: tuple[float, float, float, float]
    attributes: dict[str, object] = field(default_factory=dict)


@dataclass
class DetectResult:
    model_id: str
    model_version: str
    width_px: int
    height_px: int
    regions: list[DetectedRegion]
    warning: str | None = None
    device: str = "cpu"


_model = None
_model_path: str | None = None
_room_model = None
_room_model_path: str | None = None
_wall_model = None
_wall_model_path: str | None = None


def is_remote_weights(value: str) -> bool:
    text = value.strip()
    if text.startswith(("http://", "https://", "hf://")):
        return True
    # Hugging Face repo id, e.g. SamirShabani/Architect
    return "/" in text and "\\" not in text and not Path(text).suffix


def default_weights_path() -> Path:
    return Path(__file__).resolve().parents[2] / "models" / "yolo_layout.pt"


def layout_weights_source(settings: Settings | None = None) -> str:
    """Resolve layout .pt path: env, local cache, then Hugging Face URL."""
    settings = settings or get_settings()
    raw = settings.yolo_weights.strip()
    local_cache = default_weights_path()
    if raw:
        if is_remote_weights(raw):
            if local_cache.is_file():
                return str(local_cache)
            return raw
        path = Path(raw)
        if not path.is_absolute():
            path = (Path(__file__).resolve().parents[2] / path).resolve()
        if path.is_file():
            return str(path)
    if local_cache.is_file():
        return str(local_cache)
    return HF_LAYOUT_WEIGHTS


def resolve_weights(settings: Settings | None = None) -> str:
    return layout_weights_source(settings)


def weights_version(source: str) -> str:
    if not source:
        return "full-page"
    if is_remote_weights(source):
        return "yolo_layout"
    return Path(source).stem


def yolo_ready(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    source = layout_weights_source(settings)
    if not source:
        return False
    if is_remote_weights(source):
        return True
    return Path(source).is_file()


def layout_enabled(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    if not yolo_ready(settings):
        return False
    return bool(settings.use_layout_detector or settings.layout_only)


def detect_ready(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    if settings.layout_only and yolo_ready(settings):
        return True
    if layout_enabled(settings) or room_enabled(settings):
        return True
    from app.yolo.mitunet import mitunet_ready
    from app.yolo.roboflow import roboflow_ready
    from app.yolo.mmdet_wall import mmdet_wall_ready
    from app.yolo.floordata import floordata_ready

    if roboflow_ready(settings):
        return True
    backend = (settings.wall_backend or "").strip().lower()
    if backend == "mitunet" and mitunet_ready(settings):
        return True
    if backend == "yolo" and wall_yolo_ready(settings):
        return True
    if mmdet_wall_ready(settings, backend):
        return True
    if floordata_ready(settings, backend):
        return True
    return False


def default_room_weights_path() -> Path:
    return Path(__file__).resolve().parents[2] / "models" / "architect_floorplan.pt"


def resolve_room_weights(settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    raw = settings.yolo_room_weights.strip()
    if not raw:
        return ""
    local_cache = default_room_weights_path()
    if is_remote_weights(raw):
        if raw in {HF_ROOM_WEIGHTS, HF_ROOM_HUB, f"hf://{HF_ROOM_HUB}"} and local_cache.is_file():
            return str(local_cache)
        return raw
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parents[2] / path).resolve()
    return str(path)


def room_yolo_ready(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    raw = settings.yolo_room_weights.strip()
    if not raw:
        return False
    if is_remote_weights(raw):
        return True
    return Path(resolve_room_weights(settings)).is_file()


def room_enabled(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    return bool(settings.use_room_detector) and room_yolo_ready(settings)


def default_wall_weights_path() -> Path:
    return Path(__file__).resolve().parents[2] / "models" / "yolo_walls_obb.pt"


def resolve_wall_weights(settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    raw = settings.yolo_wall_weights.strip()
    if not raw:
        return ""
    local_cache = default_wall_weights_path()
    if is_remote_weights(raw):
        if raw in {HF_WALL_WEIGHTS, HF_WALL_HUB, f"hf://{HF_WALL_HUB}"} and local_cache.is_file():
            return str(local_cache)
        return raw
    path = Path(raw)
    if not path.is_absolute():
        path = (Path(__file__).resolve().parents[2] / path).resolve()
    return str(path)


def wall_yolo_ready(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    raw = settings.yolo_wall_weights.strip()
    if not raw:
        return False
    if is_remote_weights(raw):
        return True
    return Path(resolve_wall_weights(settings)).is_file()


def _load_rgb(image_bytes: bytes) -> np.ndarray:
    return np.asarray(Image.open(BytesIO(image_bytes)).convert("RGB"))


def _simplify(points: np.ndarray) -> np.ndarray:
    if points.shape[0] <= MAX_POLYGON_VERTICES:
        return points
    step = int(np.ceil(points.shape[0] / MAX_POLYGON_VERTICES))
    return points[::step]


def _bbox(poly: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    return (min_x, min_y, max_x - min_x, max_y - min_y)


def _label_for_class(class_id: int, names: dict) -> str:
    return str(
        names.get(
            int(class_id),
            names.get(
                str(class_id),
                CLASS_NAMES[int(class_id)] if int(class_id) < len(CLASS_NAMES) else "other",
            ),
        )
    )


def get_yolo_model(settings: Settings | None = None):
    """Lazy-load Ultralytics YOLO. Import is deferred so CI can run without torch."""
    global _model, _model_path
    settings = settings or get_settings()
    source = resolve_weights(settings)
    if not source or (not is_remote_weights(source) and not Path(source).is_file()):
        raise FileNotFoundError(
            "Layout detector weights are not set. Set USE_LAYOUT_DETECTOR=true and "
            "YOLO_WEIGHTS to a local .pt path or URL when you have a layout model."
        )
    key = source
    if _model is None or _model_path != key:
        from ultralytics import YOLO

        _model = YOLO(key)
        _model_path = key
    return _model


def get_room_model(settings: Settings | None = None):
    global _room_model, _room_model_path
    settings = settings or get_settings()
    source = resolve_room_weights(settings)
    if not source:
        raise FileNotFoundError("YOLO_ROOM_WEIGHTS is empty.")
    if not is_remote_weights(source) and not Path(source).is_file():
        raise FileNotFoundError(f"Room-seg weights not found at {source}.")
    if _room_model is None or _room_model_path != source:
        from ultralytics import YOLO

        _room_model = YOLO(source)
        _room_model_path = source
    return _room_model


def get_wall_model(settings: Settings | None = None):
    global _wall_model, _wall_model_path
    settings = settings or get_settings()
    source = resolve_wall_weights(settings)
    if not source:
        raise FileNotFoundError("YOLO_WALL_WEIGHTS is empty.")
    if not is_remote_weights(source) and not Path(source).is_file():
        raise FileNotFoundError(f"Wall detector weights not found at {source}.")
    if _wall_model is None or _wall_model_path != source:
        from ultralytics import YOLO

        _wall_model = YOLO(source)
        _wall_model_path = source
    return _wall_model


def _predict_regions(model, rgb: np.ndarray, *, imgsz: int, conf: float, device: str) -> list[DetectedRegion]:
    src_h, src_w = rgb.shape[:2]
    preds = model.predict(
        source=rgb,
        imgsz=imgsz,
        conf=conf,
        device=device,
        verbose=False,
    )
    result = preds[0] if preds else None
    if result is None:
        return []
    return regions_from_ultralytics(result, src_w=src_w, src_h=src_h, target_w=src_w, target_h=src_h)


def _scale_region_to_original(region: DetectedRegion, sx: float, sy: float) -> DetectedRegion:
    """Return a scaled copy — never mutate ``region`` (stream progress must not alter collected)."""
    if abs(sx - 1.0) <= 1e-9 and abs(sy - 1.0) <= 1e-9:
        return region
    attrs = dict(region.attributes or {})
    crop_px = attrs.get("cropPx")
    if isinstance(crop_px, dict):
        attrs["cropPx"] = scale_crop_px(crop_px, sx, sy)
    return DetectedRegion(
        id=region.id,
        type=region.type,
        label=region.label,
        confidence=region.confidence,
        polygon=scale_polygon(region.polygon, sx, sy),
        bbox=scale_bbox(region.bbox, sx, sy),
        attributes=attrs,
    )


def _append_region(
    regions: list[DetectedRegion],
    *,
    class_id: int,
    conf: float,
    poly: list[tuple[float, float]],
    names: dict,
) -> None:
    if len(poly) < 3:
        return
    label_raw = _label_for_class(class_id, names)
    label = display_label(label_raw)
    regions.append(
        DetectedRegion(
            id=str(uuid4()),
            type=entity_type_for(label_raw),
            label=label,
            confidence=round(float(conf), 4),
            polygon=poly,
            bbox=_bbox(poly),
            attributes={
                "roomType": room_type_for(label_raw),
                "label": label,
                "source": "yolo",
                "classId": int(class_id),
            },
        )
    )


def regions_from_ultralytics(
    result,
    *,
    src_w: int,
    src_h: int,
    target_w: int,
    target_h: int,
) -> list[DetectedRegion]:
    """Map one Ultralytics result to overlay regions (original-image pixels)."""
    sx = target_w / src_w if src_w else 1.0
    sy = target_h / src_h if src_h else 1.0
    names = result.names if getattr(result, "names", None) else {i: n for i, n in enumerate(CLASS_NAMES)}
    regions: list[DetectedRegion] = []

    obb = getattr(result, "obb", None)
    if obb is not None and len(obb) > 0:
        cls_ids = obb.cls.cpu().numpy().astype(int)
        confs = obb.conf.cpu().numpy().astype(float)
        corners = obb.xyxyxyxy.cpu().numpy()
        for i, class_id in enumerate(cls_ids):
            pts = np.asarray(corners[i], dtype=np.float64).reshape(-1, 2)
            poly = [(float(x) * sx, float(y) * sy) for x, y in pts]
            _append_region(regions, class_id=int(class_id), conf=float(confs[i]), poly=poly, names=names)
        return regions

    boxes = getattr(result, "boxes", None)
    masks = getattr(result, "masks", None)
    if boxes is None or len(boxes) == 0:
        return regions

    cls_ids = boxes.cls.cpu().numpy().astype(int)
    confs = boxes.conf.cpu().numpy().astype(float)
    xyxy = boxes.xyxy.cpu().numpy().astype(float)

    mask_xy = None
    if masks is not None and getattr(masks, "xy", None) is not None:
        mask_xy = masks.xy

    for i, class_id in enumerate(cls_ids):
        if mask_xy is not None and i < len(mask_xy) and len(mask_xy[i]) >= 3:
            pts = _simplify(np.asarray(mask_xy[i], dtype=np.float64))
            poly = [(float(x) * sx, float(y) * sy) for x, y in pts]
        else:
            x1, y1, x2, y2 = xyxy[i]
            poly = [
                (float(x1) * sx, float(y1) * sy),
                (float(x2) * sx, float(y1) * sy),
                (float(x2) * sx, float(y2) * sy),
                (float(x1) * sx, float(y2) * sy),
            ]
        _append_region(regions, class_id=int(class_id), conf=float(confs[i]), poly=poly, names=names)
    return regions


def _offset_into_page(
    regions: list[DetectedRegion],
    crop,
    *,
    parent_id: str,
    source: str,
) -> list[DetectedRegion]:
    for region in regions:
        region.polygon = offset_polygon(region.polygon, crop.x0, crop.y0)
        region.bbox = offset_bbox(region.bbox, crop.x0, crop.y0)
        region.attributes["parentId"] = parent_id
        region.attributes["source"] = source
    return regions


def _detect_layout_on_full_page(
    rgb: np.ndarray,
    *,
    predict_fn,
    tile_size: int,
    on_progress=None,
    cancel_check=None,
) -> list[DetectedRegion]:
    """Layout regions are sheet-level — one pass on the full page, never tiled."""
    from app.yolo.tiling import _detect_single_pass

    return _detect_single_pass(
        rgb,
        predict_fn=predict_fn,
        tile_size=tile_size,
        on_progress=on_progress,
        cancel_check=cancel_check,
    )


def detect_page_regions(
    image_bytes: bytes,
    *,
    original_width: int | None = None,
    original_height: int | None = None,
    settings: Settings | None = None,
    drawing_crop: dict[str, float] | None = None,
    on_progress=None,
    cancel_check=None,
) -> DetectResult:
    """Walls/fixtures inside the drawing crop when provided; layout is sheet-level."""
    settings = settings or get_settings()
    rgb = _load_rgb(image_bytes)
    src_h, src_w = rgb.shape[:2]
    target_w = original_width or src_w
    target_h = original_height or src_h
    device = settings.device.value
    sx = target_w / src_w if src_w else 1.0
    sy = target_h / src_h if src_h else 1.0

    from app.yolo.tiling import map_progress_coords

    def _tile_progress(crop):
        return map_progress_coords(
            on_progress,
            dx=float(crop.x0),
            dy=float(crop.y0),
            sx=sx,
            sy=sy,
        )

    layout_on = layout_enabled(settings)
    layout_only = bool(settings.layout_only)
    layout_src: list[DetectedRegion] = []
    client_crop = drawing_crop if isinstance(drawing_crop, dict) else None

    if layout_on and layout_only:
        layout_progress = map_progress_coords(on_progress, sx=sx, sy=sy)
        layout_tile_size = int(settings.yolo_imgsz or settings.detect_tile_size or 640)
        predict_layout = lambda crop_rgb: _predict_regions(
            get_yolo_model(settings),
            crop_rgb,
            imgsz=settings.yolo_imgsz,
            conf=settings.yolo_conf,
            device=device,
        )
        layout_src = _detect_layout_on_full_page(
            rgb,
            predict_fn=predict_layout,
            tile_size=layout_tile_size,
            on_progress=layout_progress,
            cancel_check=cancel_check,
        )
    elif layout_on and client_crop is None:
        # Wall pipeline without a client crop — find drawing area on the server first.
        layout_progress = map_progress_coords(on_progress, sx=sx, sy=sy)
        layout_tile_size = int(settings.yolo_imgsz or settings.detect_tile_size or 640)
        predict_layout = lambda crop_rgb: _predict_regions(
            get_yolo_model(settings),
            crop_rgb,
            imgsz=settings.yolo_imgsz,
            conf=settings.yolo_conf,
            device=device,
        )
        layout_src = _detect_layout_on_full_page(
            rgb,
            predict_fn=predict_layout,
            tile_size=layout_tile_size,
            on_progress=layout_progress,
            cancel_check=cancel_check,
        )

    if layout_only:
        warning = None
        if not layout_src:
            warning = "Layout detector found no drawing area, legend, or title block on this page."
        regions = [
            _scale_region_to_original(region, sx, sy) for region in layout_src
        ]
        source = layout_weights_source(settings)
        return DetectResult(
            model_id=HF_LAYOUT_MODEL_ID,
            model_version=weights_version(source),
            width_px=target_w,
            height_px=target_h,
            regions=regions,
            warning=warning,
            device=device,
        )

    drawings = select_drawing_areas(layout_src) if layout_src else []
    wall_src: list[DetectedRegion] = []
    room_src: list[DetectedRegion] = []
    warning: str | None = None
    from app.yolo.roboflow import detect_roboflow_regions, is_wall_region, roboflow_ready

    wall_backend = (settings.wall_backend or "mitunet").strip().lower()
    # Only run Roboflow when explicitly selected (wall:roboflow).
    rf_on = wall_backend == "roboflow" and roboflow_ready(settings)
    from app.yolo.mitunet import (
        MITUNET_MODEL_ID,
        mitunet_ready,
        wall_polygons_from_rgb,
    )
    from app.yolo.mmdet_wall import MMDET_MODEL_IDS, detect_mmdet_walls, mmdet_wall_ready
    from app.yolo.floordata import FLOORDATA_MODEL_IDS, detect_floordata_walls, floordata_ready
    from app.yolo.wall_registry import FLOORDATA_WALL_BACKENDS, LEGACY_WALL_BACKENDS

    mitunet_on = wall_backend == "mitunet" and mitunet_ready(settings)
    mmdet_on = wall_backend in LEGACY_WALL_BACKENDS and mmdet_wall_ready(settings, wall_backend)
    floordata_on = wall_backend in FLOORDATA_WALL_BACKENDS and floordata_ready(settings, wall_backend)
    walls_on = (
        (not rf_on)
        and (not mitunet_on)
        and (not mmdet_on)
        and (not floordata_on)
        and wall_backend == "yolo"
        and wall_yolo_ready(settings)
    )
    rooms_on = (not rf_on) and room_enabled(settings)

    jobs: list[tuple[str, object]] = []
    if client_crop:
        manual = crop_page_normalized(rgb, client_crop, pad_frac=settings.yolo_crop_pad)
        if manual:
            jobs.append(("drawing", manual))
    if not jobs:
        for drawing in drawings:
            crop = crop_page(rgb, drawing.bbox, pad_frac=settings.yolo_crop_pad)
            if crop is None:
                continue
            drawing.attributes["cropPx"] = {
                "x": crop.x0,
                "y": crop.y0,
                "width": crop.width,
                "height": crop.height,
            }
            jobs.append((drawing.id, crop))
    if not jobs:
        jobs.append(("page", full_page_crop(rgb)))

    for parent_id, crop in jobs:
        tile_in_drawing = parent_id != "page"
        if rf_on:
            from app.yolo.tiling import detect_on_crop

            rf_regions = detect_on_crop(
                crop.rgb,
                settings=settings,
                predict_fn=lambda crop_rgb: detect_roboflow_regions(
                    crop_rgb, settings=settings
                ),
                tile_size=int(settings.detect_tile_size or 640),
                on_progress=_tile_progress(crop),
                cancel_check=cancel_check,
                use_tiling=tile_in_drawing,
            )
            rf_regions = _offset_into_page(
                rf_regions, crop, parent_id=parent_id, source="roboflow"
            )
            for region in rf_regions:
                if is_wall_region(region):
                    if not mitunet_on:
                        wall_src.append(region)
                else:
                    room_src.append(region)
        if mitunet_on:
            from app.yolo.tiling import detect_on_crop

            def _mitunet_tile(crop_rgb):
                polygons, confidence = wall_polygons_from_rgb(crop_rgb, settings)
                regions: list[DetectedRegion] = []
                for polygon in polygons:
                    regions.append(
                        DetectedRegion(
                            id=str(uuid4()),
                            type="wall",
                            label="Wall",
                            confidence=round(confidence, 4),
                            polygon=polygon,
                            bbox=_bbox(polygon),
                            attributes={
                                "roomType": "wall",
                                "label": "Wall",
                                "source": "mitunet",
                            },
                        )
                    )
                return regions

            mitunet_regions = detect_on_crop(
                crop.rgb,
                settings=settings,
                predict_fn=_mitunet_tile,
                tile_size=int(settings.mitunet_wall_imgsz or settings.detect_tile_size or 512),
                on_progress=_tile_progress(crop),
                cancel_check=cancel_check,
                use_tiling=tile_in_drawing,
            )
            wall_src.extend(
                _offset_into_page(
                    mitunet_regions, crop, parent_id=parent_id, source="mitunet"
                )
            )
        if mmdet_on:
            from app.yolo.tiling import detect_on_crop

            mmdet_regions = detect_on_crop(
                crop.rgb,
                settings=settings,
                predict_fn=lambda crop_rgb: detect_mmdet_walls(
                    crop_rgb, settings=settings, backend=wall_backend
                ),
                tile_size=int(settings.yolo_wall_imgsz or settings.detect_tile_size or 896),
                on_progress=_tile_progress(crop),
                cancel_check=cancel_check,
                use_tiling=tile_in_drawing,
            )
            wall_src.extend(
                _offset_into_page(
                    mmdet_regions, crop, parent_id=parent_id, source=wall_backend
                )
            )
        if floordata_on:
            from app.yolo.tiling import detect_on_crop

            floordata_regions = detect_on_crop(
                crop.rgb,
                settings=settings,
                predict_fn=lambda crop_rgb: detect_floordata_walls(
                    crop_rgb, settings=settings, backend=wall_backend
                ),
                tile_size=int(settings.floordata_imgsz or settings.detect_tile_size or 512),
                on_progress=_tile_progress(crop),
                cancel_check=cancel_check,
                use_tiling=tile_in_drawing,
            )
            wall_src.extend(
                _offset_into_page(
                    floordata_regions, crop, parent_id=parent_id, source=wall_backend
                )
            )
        if walls_on:
            from app.yolo.tiling import detect_on_crop

            walls = detect_on_crop(
                crop.rgb,
                settings=settings,
                predict_fn=lambda crop_rgb: _predict_regions(
                    get_wall_model(settings),
                    crop_rgb,
                    imgsz=settings.yolo_wall_imgsz,
                    conf=settings.yolo_wall_conf,
                    device=device,
                ),
                tile_size=int(settings.yolo_wall_imgsz or settings.detect_tile_size or 896),
                on_progress=_tile_progress(crop),
                cancel_check=cancel_check,
                use_tiling=tile_in_drawing,
            )
            wall_src.extend(
                _offset_into_page(walls, crop, parent_id=parent_id, source="yolo_walls")
            )
        if rooms_on:
            from app.yolo.tiling import detect_on_crop

            rooms = detect_on_crop(
                crop.rgb,
                settings=settings,
                predict_fn=lambda crop_rgb: _predict_regions(
                    get_room_model(settings),
                    crop_rgb,
                    imgsz=settings.yolo_room_imgsz,
                    conf=settings.yolo_room_conf,
                    device=device,
                ),
                tile_size=int(settings.yolo_room_imgsz or settings.detect_tile_size or 640),
                on_progress=_tile_progress(crop),
                cancel_check=cancel_check,
                use_tiling=tile_in_drawing,
            )
            room_src.extend(
                _offset_into_page(rooms, crop, parent_id=parent_id, source="yolo_rooms")
            )

    if layout_on and not layout_src and not client_crop:
        warning = (
            "Layout detector found no drawing area, legend, or title block; "
            "ran walls and fixtures on the full page (single pass, not tiled)."
        )
    elif layout_on and not drawings and not client_crop:
        warning = (
            "No drawing area on this sheet; ran walls and fixtures on the full page "
            "(single pass, not tiled)."
        )
    elif not client_crop and not drawings and jobs and jobs[0][0] == "page":
        warning = (
            "No drawing area region — run layout detect or draw a drawing area box first. "
            "Ran detection on the full page (single pass, not tiled)."
        )
    elif rf_on and not mitunet_on and not wall_src and not room_src:
        warning = "Roboflow floorplan-iculh found no instances on this page."
    elif (mitunet_on or mmdet_on or floordata_on or walls_on) and not wall_src and rooms_on and not room_src:
        warning = "No walls or fixtures found on this page."
    elif (mitunet_on or mmdet_on or floordata_on or walls_on) and not wall_src:
        warning = "Wall detector found no segments on this page."
    elif rooms_on and not room_src:
        warning = "No doors, windows, or fixtures found on this page."

    sx = target_w / src_w if src_w else 1.0
    sy = target_h / src_h if src_h else 1.0

    if wall_src and (mitunet_on or floordata_on):
        from app.yolo.tiling import stitch_wall_regions

        wall_src = stitch_wall_regions(wall_src)

    regions = [
        _scale_region_to_original(region, sx, sy)
        for region in [*layout_src, *wall_src, *room_src]
    ]

    parts: list[str] = []
    if layout_on:
        parts.append(HF_LAYOUT_MODEL_ID)
    if rf_on:
        parts.append(settings.roboflow_model_id.replace("/", "-"))
    if wall_src and mitunet_on:
        parts.append(MITUNET_MODEL_ID)
    elif wall_src and mmdet_on:
        parts.append(MMDET_MODEL_IDS.get(wall_backend, wall_backend))
    elif wall_src and floordata_on:
        parts.append(FLOORDATA_MODEL_IDS.get(wall_backend, wall_backend))
    elif wall_src and not rf_on:
        parts.append(HF_WALL_MODEL_ID)
    if room_src and not rf_on:
        parts.append(HF_ROOM_MODEL_ID)
    if layout_on:
        weights = resolve_weights(settings)
    elif mmdet_on:
        from app.yolo.wall_registry import resolve_legacy_wall_weights_for_backend

        weights = resolve_legacy_wall_weights_for_backend(settings, wall_backend)
    elif floordata_on:
        from app.yolo.wall_registry import resolve_legacy_wall_weights_for_backend

        weights = resolve_legacy_wall_weights_for_backend(settings, wall_backend)
    elif rooms_on:
        weights = resolve_room_weights(settings)
    else:
        weights = resolve_wall_weights(settings)
    return DetectResult(
        model_id="+".join(parts) or "full-page",
        model_version=weights_version(weights),
        width_px=int(target_w),
        height_px=int(target_h),
        regions=regions,
        warning=warning,
        device=device,
    )
