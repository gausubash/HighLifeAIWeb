"""Roboflow hosted / cached floor-plan models.

Wall detect uses Universe walldetection-iekzl/archvision_wall_detect.
Room detect uses floorplan-9fxye. Prefer on-device ONNX under models/roboflow_cache/;
fall back to detect.roboflow.com when ROBOFLOW_API_KEY is set.

Prefetch once (Python 3.10–3.12 + inference package):

  .venv-tf\\Scripts\\python.exe scripts/prefetch_roboflow.py
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
from uuid import uuid4

import httpx
import numpy as np
from PIL import Image

from app.config import Settings, get_settings, yolo_predict_device
from app.yolo.classes import display_label, entity_type_for, opening_type_for, room_type_for
from app.yolo.compass_keypoints import attach_keypoints, parse_prediction_keypoints

DEFAULT_MODEL_ID = "floorplan-iculh/1"
DEFAULT_WALL_MODEL_ID = "archvision_wall_detect/1"
DEFAULT_ROOM_MODEL_ID = "floorplan-9fxye/1"
DEFAULT_FLOORPLAN_SEG_MODEL_ID = "floorplan-segmentation-imdze/4"
DETECT_BASE = "https://detect.roboflow.com"


def normalize_roboflow_model_id(model_id: str | None, default: str = DEFAULT_MODEL_ID) -> str:
    """Accept project/version or workspace/project/version."""
    parts = [p for p in (model_id or "").strip().strip("/").split("/") if p]
    if len(parts) >= 2:
        return f"{parts[-2]}/{parts[-1]}"
    return default

_local_model = None
_local_model_path: str | None = None


def default_roboflow_cache_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "models" / "roboflow_cache"


def resolve_roboflow_weights(
    settings: Settings | None = None,
    *,
    model_id: str | None = None,
    weights_override: str | None = None,
) -> Path | None:
    """Return local ONNX/PT path when available."""
    settings = settings or get_settings()
    override = (weights_override if weights_override is not None else getattr(settings, "roboflow_weights", None) or "").strip()
    if override:
        path = Path(override)
        return path if path.is_file() else None
    resolved = normalize_roboflow_model_id(
        model_id or settings.roboflow_model_id,
        DEFAULT_MODEL_ID,
    )
    project, version = resolved.split("/", 1)
    cached = default_roboflow_cache_dir() / project / version / "weights.onnx"
    if cached.is_file():
        return cached
    if project == "floorplan-iculh":
        alt = Path(__file__).resolve().parents[2] / "models" / "roboflow_floorplan_iculh.onnx"
        return alt if alt.is_file() else None
    return None


def resolve_roboflow_wall_weights(settings: Settings | None = None) -> Path | None:
    settings = settings or get_settings()
    return resolve_roboflow_weights(
        settings,
        model_id=getattr(settings, "roboflow_wall_model_id", None) or DEFAULT_WALL_MODEL_ID,
        weights_override=getattr(settings, "roboflow_wall_weights", None) or "",
    )


def resolve_roboflow_room_weights(settings: Settings | None = None) -> Path | None:
    settings = settings or get_settings()
    return resolve_roboflow_weights(
        settings,
        model_id=getattr(settings, "roboflow_room_model_id", None) or DEFAULT_ROOM_MODEL_ID,
        weights_override=getattr(settings, "roboflow_room_weights", None) or "",
    )


def resolve_roboflow_floorplan_seg_weights(settings: Settings | None = None) -> Path | None:
    settings = settings or get_settings()
    return resolve_roboflow_weights(
        settings,
        model_id=getattr(settings, "roboflow_floorplan_seg_model_id", None)
        or DEFAULT_FLOORPLAN_SEG_MODEL_ID,
        weights_override=getattr(settings, "roboflow_floorplan_seg_weights", None) or "",
    )


def roboflow_local_ready(settings: Settings | None = None) -> bool:
    return resolve_roboflow_weights(settings) is not None


def roboflow_cloud_ready(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    return bool(settings.roboflow_api_key.strip() and settings.roboflow_model_id.strip())


def roboflow_ready(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    return roboflow_local_ready(settings) or roboflow_cloud_ready(settings)


def roboflow_wall_ready(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    if resolve_roboflow_wall_weights(settings) is not None:
        return True
    return bool(settings.roboflow_api_key.strip())


def roboflow_room_ready(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    if resolve_roboflow_room_weights(settings) is not None:
        return True
    return bool(settings.roboflow_api_key.strip())


def roboflow_floorplan_seg_ready(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    if resolve_roboflow_floorplan_seg_weights(settings) is not None:
        return True
    return bool(settings.roboflow_api_key.strip())


def _bbox(poly: list[tuple[float, float]]) -> tuple[float, float, float, float]:
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    return (min_x, min_y, max_x - min_x, max_y - min_y)


def _png_bytes(rgb: np.ndarray) -> bytes:
    buf = BytesIO()
    Image.fromarray(rgb).save(buf, format="PNG")
    return buf.getvalue()


def predictions_to_regions(predictions: list[dict]):
    from app.yolo.predict import DetectedRegion

    regions: list[DetectedRegion] = []
    for item in predictions:
        if not isinstance(item, dict):
            continue
        label_raw = str(item.get("class") or item.get("class_name") or "other")
        conf = float(item.get("confidence") or 0.0)
        if conf > 1.0:
            conf = conf / 100.0
        points = item.get("points")
        poly: list[tuple[float, float]] = []
        if isinstance(points, list) and len(points) >= 3:
            for point in points:
                if isinstance(point, dict):
                    poly.append((float(point["x"]), float(point["y"])))
                elif isinstance(point, (list, tuple)) and len(point) >= 2:
                    poly.append((float(point[0]), float(point[1])))
        if len(poly) < 3:
            cx = float(item.get("x") or 0.0)
            cy = float(item.get("y") or 0.0)
            width = float(item.get("width") or 0.0)
            height = float(item.get("height") or 0.0)
            if width < 1 or height < 1:
                continue
            x1, y1 = cx - width / 2.0, cy - height / 2.0
            x2, y2 = cx + width / 2.0, cy + height / 2.0
            poly = [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]
        label = display_label(label_raw)
        attributes = {
            "roomType": room_type_for(label_raw),
            "label": label,
            "source": "roboflow",
            "classId": int(item.get("class_id") or 0),
            **({"openingType": ot} if (ot := opening_type_for(label_raw)) else {}),
        }
        attach_keypoints(attributes, parse_prediction_keypoints(item))
        regions.append(
            DetectedRegion(
                id=str(uuid4()),
                type=entity_type_for(label_raw),
                label=label,
                confidence=round(conf, 4),
                polygon=poly,
                bbox=_bbox(poly),
                attributes=attributes,
            )
        )
    return regions


def is_wall_region(region) -> bool:
    if region.type == "wall":
        return True
    key = (region.label or "").strip().lower().replace("_", " ").replace("-", " ")
    return key in {
        "wall",
        "walls",
        "partition",
        "external wall",
        "interior wall",
        "internal wall",
    }


def is_opening_region(region) -> bool:
    if region.type in {"door", "window"}:
        return True
    key = (region.label or "").strip().lower().replace("_", " ").replace("-", " ")
    return key in {
        "door",
        "doors",
        "window",
        "windows",
        "single door",
        "sliding door",
        "main door",
        "bay window",
        "blind window",
    }


def _get_local_model(weights: Path):
    global _local_model, _local_model_path
    key = str(weights.resolve())
    if _local_model is None or _local_model_path != key:
        from ultralytics import YOLO

        _local_model = YOLO(key, task="segment")
        _local_model_path = key
    return _local_model


def detect_roboflow_local(
    rgb: np.ndarray,
    *,
    settings: Settings | None = None,
):
    settings = settings or get_settings()
    weights = resolve_roboflow_weights(settings)
    if weights is None:
        raise FileNotFoundError(
            "Local Roboflow weights missing. Run: "
            ".venv-tf\\Scripts\\python.exe scripts/prefetch_roboflow.py"
        )
    from app.yolo.predict import regions_from_ultralytics

    model = _get_local_model(weights)
    device = yolo_predict_device(settings)
    imgsz = 640
    conf = float(settings.roboflow_conf or 0.25)
    preds = model.predict(source=rgb, imgsz=imgsz, conf=conf, device=device, verbose=False)
    result = preds[0] if preds else None
    if result is None:
        return []
    src_h, src_w = rgb.shape[:2]
    regions = regions_from_ultralytics(result, src_w=src_w, src_h=src_h, target_w=src_w, target_h=src_h)
    for region in regions:
        region.attributes["source"] = "roboflow-local"
    return regions


def detect_roboflow_cloud(
    rgb: np.ndarray,
    *,
    settings: Settings | None = None,
    model_id: str | None = None,
):
    settings = settings or get_settings()
    api_key = settings.roboflow_api_key.strip()
    resolved = normalize_roboflow_model_id(
        model_id or settings.roboflow_model_id,
        DEFAULT_MODEL_ID,
    )
    if not api_key:
        raise RuntimeError("ROBOFLOW_API_KEY is empty.")

    url = f"{DETECT_BASE}/{resolved}"
    conf_pct = max(1, min(100, int(round(settings.roboflow_conf * 100))))
    png = _png_bytes(rgb)
    with httpx.Client(timeout=90.0) as client:
        res = client.post(
            url,
            params={"api_key": api_key, "confidence": conf_pct, "overlap": 30},
            files={"file": ("crop.png", png, "image/png")},
        )
    if res.status_code >= 400:
        raise RuntimeError(f"Roboflow detect failed ({res.status_code}): {res.text[:300]}")
    payload = res.json()
    predictions = payload.get("predictions") if isinstance(payload, dict) else None
    if not isinstance(predictions, list):
        return []
    return predictions_to_regions(predictions)


def detect_roboflow_regions(
    rgb: np.ndarray,
    *,
    settings: Settings | None = None,
):
    """Prefer local ONNX; fall back to hosted Roboflow API."""
    settings = settings or get_settings()
    if roboflow_local_ready(settings):
        return detect_roboflow_local(rgb, settings=settings)
    return detect_roboflow_cloud(rgb, settings=settings)


def detect_roboflow_wall_regions(
    rgb: np.ndarray,
    *,
    settings: Settings | None = None,
):
    """Universe walldetection-iekzl/archvision_wall_detect wall masks or boxes."""
    settings = settings or get_settings()
    model_id = getattr(settings, "roboflow_wall_model_id", None) or DEFAULT_WALL_MODEL_ID
    weights = resolve_roboflow_wall_weights(settings)
    if weights is not None:
        regions = detect_roboflow_local(
            rgb,
            settings=settings.model_copy(
                update={"roboflow_weights": str(weights), "roboflow_model_id": model_id}
            ),
        )
    else:
        regions = detect_roboflow_cloud(rgb, settings=settings, model_id=model_id)
    return [region for region in regions if is_wall_region(region)]


def detect_roboflow_room_regions(
    rgb: np.ndarray,
    *,
    settings: Settings | None = None,
):
    """Office room instances from Universe floorplan-cvjp0/floorplan-9fxye."""
    settings = settings or get_settings()
    model_id = getattr(settings, "roboflow_room_model_id", None) or DEFAULT_ROOM_MODEL_ID
    weights = resolve_roboflow_room_weights(settings)
    if weights is not None:
        return detect_roboflow_local(rgb, settings=settings.model_copy(update={"roboflow_weights": str(weights)}))
    return detect_roboflow_cloud(rgb, settings=settings, model_id=model_id)


def detect_roboflow_floorplan_seg_regions(
    rgb: np.ndarray,
    *,
    settings: Settings | None = None,
    detect_task: str | None = None,
):
    """Universe floorplan-lfnvy/floorplan-segmentation-imdze — wall, door, window instance seg."""
    settings = settings or get_settings()
    model_id = (
        getattr(settings, "roboflow_floorplan_seg_model_id", None) or DEFAULT_FLOORPLAN_SEG_MODEL_ID
    )
    weights = resolve_roboflow_floorplan_seg_weights(settings)
    if weights is not None:
        regions = detect_roboflow_local(
            rgb,
            settings=settings.model_copy(
                update={"roboflow_weights": str(weights), "roboflow_model_id": model_id}
            ),
        )
    else:
        regions = detect_roboflow_cloud(rgb, settings=settings, model_id=model_id)
    for region in regions:
        region.attributes["source"] = "roboflow-floorplan-seg"
    task = (detect_task or getattr(settings, "detect_task", None) or "").strip().lower()
    if task in {"walls", "wall_segmentation"}:
        return [region for region in regions if is_wall_region(region)]
    if task in {"openings", "opening_detection"}:
        return [region for region in regions if is_opening_region(region)]
    if task in {"structural", "structural_detection"}:
        for region in regions:
            region.attributes["detectFamily"] = "structural"
        return regions
    return regions
