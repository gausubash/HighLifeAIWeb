"""Roboflow floorplan-iculh wall/door segmentation.

Prefer on-device ONNX weights (cached under models/roboflow_cache/). Fall back to
detect.roboflow.com when local weights are missing and ROBOFLOW_API_KEY is set.

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

from app.config import Settings, get_settings
from app.yolo.classes import display_label, entity_type_for, room_type_for

DEFAULT_MODEL_ID = "floorplan-iculh/1"
DETECT_BASE = "https://detect.roboflow.com"

_local_model = None
_local_model_path: str | None = None


def default_roboflow_cache_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "models" / "roboflow_cache"


def resolve_roboflow_weights(settings: Settings | None = None) -> Path | None:
    """Return local ONNX/PT path when available."""
    settings = settings or get_settings()
    override = (getattr(settings, "roboflow_weights", None) or "").strip()
    if override:
        path = Path(override)
        return path if path.is_file() else None
    model_id = (settings.roboflow_model_id or DEFAULT_MODEL_ID).strip().strip("/")
    parts = [p for p in model_id.split("/") if p]
    if len(parts) >= 2:
        project, version = parts[-2], parts[-1]
    else:
        project, version = "floorplan-iculh", "1"
    cached = default_roboflow_cache_dir() / project / version / "weights.onnx"
    if cached.is_file():
        return cached
    alt = Path(__file__).resolve().parents[2] / "models" / "roboflow_floorplan_iculh.onnx"
    return alt if alt.is_file() else None


def roboflow_local_ready(settings: Settings | None = None) -> bool:
    return resolve_roboflow_weights(settings) is not None


def roboflow_cloud_ready(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    return bool(settings.roboflow_api_key.strip() and settings.roboflow_model_id.strip())


def roboflow_ready(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    return roboflow_local_ready(settings) or roboflow_cloud_ready(settings)


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
        regions.append(
            DetectedRegion(
                id=str(uuid4()),
                type=entity_type_for(label_raw),
                label=label,
                confidence=round(conf, 4),
                polygon=poly,
                bbox=_bbox(poly),
                attributes={
                    "roomType": room_type_for(label_raw),
                    "label": label,
                    "source": "roboflow",
                    "classId": int(item.get("class_id") or 0),
                },
            )
        )
    return regions


def is_wall_region(region) -> bool:
    if region.type == "wall":
        return True
    key = (region.label or "").strip().lower().replace("_", " ")
    return key in {"wall", "walls", "partition", "external wall", "interior wall"}


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
    device = (settings.device.value if hasattr(settings.device, "value") else str(settings.device)) or "cpu"
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
):
    settings = settings or get_settings()
    api_key = settings.roboflow_api_key.strip()
    model_id = settings.roboflow_model_id.strip() or DEFAULT_MODEL_ID
    if not api_key:
        raise RuntimeError("ROBOFLOW_API_KEY is empty.")

    url = f"{DETECT_BASE}/{model_id.lstrip('/')}"
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
