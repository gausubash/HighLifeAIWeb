"""Per-request wall / MitUNet inference overrides from detect form fields."""

from __future__ import annotations

from typing import Any


def _parse_bool(raw: str | None, default: bool) -> bool:
    if raw is None:
        return default
    text = str(raw).strip().lower()
    if not text:
        return default
    return text not in {"0", "false", "no", "off"}


def _parse_int(raw: str | None) -> int | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        return int(float(text))
    except (TypeError, ValueError):
        return None


def _parse_float(raw: str | None) -> float | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def wall_infer_overrides(
    *,
    tile_walls: str = "",
    wall_imgsz: str = "",
    wall_threshold: str = "",
    tile_overlap: str = "",
) -> dict[str, Any]:
    """Return Settings.model_copy update keys. Empty fields keep server defaults."""
    update: dict[str, Any] = {}
    if str(tile_walls).strip():
        update["detect_tile_enabled"] = _parse_bool(tile_walls, True)
    imgsz = _parse_int(wall_imgsz)
    if imgsz is not None:
        size = max(256, min(1024, imgsz))
        update["mitunet_wall_imgsz"] = size
        update["detect_tile_size"] = size
        update["yolo_room_imgsz"] = size
        update["detect_tile_min_side"] = size
    threshold = _parse_float(wall_threshold)
    if threshold is not None:
        conf = max(0.05, min(0.95, threshold))
        update["mitunet_wall_threshold"] = conf
        update["yolo_room_conf"] = conf
        update["roboflow_conf"] = conf
    overlap = _parse_float(tile_overlap)
    if overlap is not None:
        update["detect_tile_overlap"] = max(0.0, min(0.5, overlap))
    return update
