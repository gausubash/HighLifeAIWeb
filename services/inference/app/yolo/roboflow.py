"""Roboflow Universe inference for crop-stage floor-plan classes.

Universe hosted models (e.g. floor-r1kta/floorplan-iculh) are not downloadable
.pt files. They run via detect.roboflow.com with ROBOFLOW_API_KEY.
"""

from __future__ import annotations

from io import BytesIO
from uuid import uuid4

import httpx
import numpy as np
from PIL import Image

from app.config import Settings, get_settings
from app.yolo.classes import display_label, entity_type_for, room_type_for

DEFAULT_MODEL_ID = "floorplan-iculh/1"
DETECT_BASE = "https://detect.roboflow.com"


def roboflow_ready(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    return bool(settings.roboflow_api_key.strip() and settings.roboflow_model_id.strip())


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


def detect_roboflow_regions(
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
