"""Compass / north-arrow keypoints (Roboflow + YOLO-pose, COCO visibility)."""

from __future__ import annotations

from typing import Any

import numpy as np

TIP_ALIASES = frozenset(
    {"tip", "head", "north", "arrow_tip", "arrowhead", "arrow head", "point", "n"}
)
BASE_ALIASES = frozenset(
    {"base", "tail", "origin", "arrow_base", "arrow tail", "pivot", "s", "south"}
)


def _norm_name(value: str) -> str:
    return " ".join((value or "").strip().lower().replace("_", " ").replace("-", " ").split())


def coco_visibility(value: Any) -> str:
    """Map Roboflow / COCO visibility to visible | occluded | not_labeled."""
    if value is None or value == "":
        return "visible"
    if isinstance(value, bool):
        return "visible" if value else "not_labeled"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if value <= 0:
            return "not_labeled"
        if int(value) == 1:
            return "occluded"
        return "visible"
    raw = _norm_name(str(value))
    if raw in {"0", "not labeled", "unlabeled", "hidden", "none", "false"}:
        return "not_labeled"
    if raw in {"1", "occluded", "invisible"}:
        return "occluded"
    if raw in {"2", "visible", "labeled", "true"}:
        return "visible"
    return "visible"


def keypoint_role(name: str | None, index: int, count: int) -> str | None:
    key = _norm_name(name or "")
    if key in TIP_ALIASES or "tip" in key or "head" in key:
        return "tip"
    if key in BASE_ALIASES or "base" in key or "tail" in key:
        return "base"
    if count == 2:
        return "base" if index == 0 else "tip"
    return None


def _as_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if np.isfinite(number) else None


def _merge_named(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_name: dict[str, dict[str, Any]] = {}
    for item in items:
        name = item.get("name")
        if name not in {"tip", "base"}:
            continue
        prev = by_name.get(str(name))
        if prev is None or float(item.get("confidence") or 0) >= float(prev.get("confidence") or 0):
            by_name[str(name)] = item
    return [by_name[name] for name in ("tip", "base") if name in by_name]


def _from_dict(raw: dict[str, Any], name_hint: str | None, index: int, count: int) -> dict[str, Any] | None:
    x = _as_float(raw.get("x", raw.get("cx")))
    y = _as_float(raw.get("y", raw.get("cy")))
    if x is None or y is None:
        return None
    name_raw = raw.get("class") or raw.get("name") or raw.get("label") or name_hint
    name = keypoint_role(str(name_raw) if name_raw is not None else None, index, count)
    if name is None:
        return None
    occluded = raw.get("occluded") in {True, 1, "1", "true", "True"}
    visibility = "occluded" if occluded else coco_visibility(raw.get("visibility", raw.get("v", raw.get("visible"))))
    item: dict[str, Any] = {
        "name": name,
        "x": float(x),
        "y": float(y),
        "visibility": visibility,
        "source": "model",
    }
    conf = _as_float(raw.get("confidence", raw.get("conf", raw.get("score"))))
    if conf is not None:
        item["confidence"] = conf if conf <= 1.0 else conf / 100.0
    return item


def parse_prediction_keypoints(item: dict[str, Any]) -> list[dict[str, Any]]:
    """Parse Roboflow inference JSON (list, named map, or COCO flat array)."""
    raw = item.get("keypoints")
    if raw is None:
        raw = item.get("compassKeypoints") or item.get("kpts")
    names = item.get("keypoint_names") or item.get("kpt_names") or []
    if isinstance(names, dict):
        names = [names.get(i, names.get(str(i), "")) for i in range(len(names))]
    if isinstance(raw, dict):
        mapped = []
        for key, value in raw.items():
            if isinstance(value, dict):
                parsed = _from_dict(value, str(key), len(mapped), 2)
                if parsed:
                    mapped.append(parsed)
        return _merge_named(mapped)
    if not isinstance(raw, list) or not raw:
        return []
    if raw and all(isinstance(v, (int, float)) for v in raw):
        count = len(raw) // 3
        mapped = []
        for i in range(count):
            hint = names[i] if isinstance(names, list) and i < len(names) else None
            role = keypoint_role(str(hint) if hint else None, i, count)
            if role is None:
                continue
            mapped.append(
                {
                    "name": role,
                    "x": float(raw[i * 3]),
                    "y": float(raw[i * 3 + 1]),
                    "visibility": coco_visibility(raw[i * 3 + 2]),
                    "source": "model",
                }
            )
        return _merge_named(mapped)
    dicts = [v for v in raw if isinstance(v, dict)]
    mapped = []
    for i, value in enumerate(dicts):
        hint = names[i] if isinstance(names, list) and i < len(names) else None
        parsed = _from_dict(value, str(hint) if hint else None, i, len(dicts))
        if parsed:
            mapped.append(parsed)
    return _merge_named(mapped)


def _as_numpy(value: Any) -> np.ndarray | None:
    if value is None:
        return None
    cpu = getattr(value, "cpu", None)
    if callable(cpu):
        value = cpu()
    numpy_fn = getattr(value, "numpy", None)
    if callable(numpy_fn):
        value = numpy_fn()
    try:
        return np.asarray(value)
    except (TypeError, ValueError):
        return None


def _keypoint_names(result: Any, count: int) -> list[str]:
    names = getattr(result, "kpt_names", None) or getattr(result, "keypoints_names", None)
    if names is None:
        names = getattr(getattr(result, "keypoints", None), "names", None)
    if isinstance(names, dict):
        return [str(names.get(i, names.get(str(i), ""))) for i in range(count)]
    if isinstance(names, (list, tuple)):
        return [str(n) for n in names]
    return []


def extract_ultralytics_keypoints(result: Any, index: int, *, sx: float = 1.0, sy: float = 1.0) -> list[dict[str, Any]]:
    """YOLO-pose keypoints for one detection, scaled into target image pixels."""
    kpts = getattr(result, "keypoints", None)
    if kpts is None:
        return []
    xy = _as_numpy(getattr(kpts, "xy", None))
    if xy is None or xy.ndim < 2 or index >= len(xy):
        data = _as_numpy(getattr(kpts, "data", None))
        if data is None or data.ndim < 2 or index >= len(data):
            return []
        xy = data[index, :, :2]
        vis = data[index, :, 2] if data.shape[-1] >= 3 else None
        conf = None
    else:
        xy = xy[index]
        data = _as_numpy(getattr(kpts, "data", None))
        vis = data[index, :, 2] if data is not None and data.ndim >= 2 and data.shape[-1] >= 3 else None
        conf_arr = _as_numpy(getattr(kpts, "conf", None))
        conf = conf_arr[index] if conf_arr is not None and index < len(conf_arr) else None
    xy = np.asarray(xy, dtype=np.float64).reshape(-1, 2)
    count = len(xy)
    if count < 2:
        return []
    names = _keypoint_names(result, count)
    mapped: list[dict[str, Any]] = []
    for i, (x, y) in enumerate(xy):
        role = keypoint_role(names[i] if i < len(names) else None, i, count)
        if role is None:
            continue
        visibility = coco_visibility(float(vis[i]) if vis is not None and i < len(vis) else 2)
        item: dict[str, Any] = {
            "name": role,
            "x": float(x) * sx,
            "y": float(y) * sy,
            "visibility": visibility,
            "source": "model",
        }
        if conf is not None and i < len(conf):
            item["confidence"] = round(float(conf[i]), 4)
        mapped.append(item)
    return _merge_named(mapped)


def heading_from_keypoints(keypoints: list[dict[str, Any]]) -> tuple[float, float, float] | None:
    by_name = {str(item.get("name")): item for item in keypoints}
    tip = by_name.get("tip")
    base = by_name.get("base")
    if not tip or not base:
        return None
    if tip.get("visibility") == "not_labeled" or base.get("visibility") == "not_labeled":
        return None
    dx = float(tip["x"]) - float(base["x"])
    dy = float(tip["y"]) - float(base["y"])
    if dx == 0.0 and dy == 0.0:
        return None
    deg = (float(np.degrees(np.arctan2(dy, dx))) + 360.0) % 360.0
    return dx, dy, deg


def scale_keypoints(keypoints: list[dict[str, Any]], sx: float, sy: float) -> list[dict[str, Any]]:
    if abs(sx - 1.0) <= 1e-9 and abs(sy - 1.0) <= 1e-9:
        return keypoints
    out = []
    for item in keypoints:
        next_item = dict(item)
        next_item["x"] = float(item["x"]) * sx
        next_item["y"] = float(item["y"]) * sy
        out.append(next_item)
    return out


def offset_keypoints(keypoints: list[dict[str, Any]], dx: float, dy: float) -> list[dict[str, Any]]:
    if abs(dx) <= 1e-9 and abs(dy) <= 1e-9:
        return keypoints
    out = []
    for item in keypoints:
        next_item = dict(item)
        next_item["x"] = float(item["x"]) + dx
        next_item["y"] = float(item["y"]) + dy
        out.append(next_item)
    return out


def transform_region_keypoints(attributes: dict[str, Any] | None, *, sx: float = 1.0, sy: float = 1.0, dx: float = 0.0, dy: float = 0.0) -> None:
    """Scale/offset keypoints stored on a DetectedRegion attributes dict (in place)."""
    if not isinstance(attributes, dict):
        return
    raw = attributes.get("keypoints")
    if not isinstance(raw, list) or not raw:
        return
    keypoints = [dict(item) for item in raw if isinstance(item, dict)]
    keypoints = scale_keypoints(keypoints, sx, sy)
    keypoints = offset_keypoints(keypoints, dx, dy)
    attributes["keypoints"] = keypoints
    heading = heading_from_keypoints(keypoints)
    if heading:
        attributes["headingVec"] = {"x": heading[0], "y": heading[1]}
        attributes["headingDeg"] = heading[2]


def attach_keypoints(attributes: dict[str, Any], keypoints: list[dict[str, Any]] | None) -> dict[str, Any]:
    if not keypoints:
        return attributes
    attributes["keypoints"] = keypoints
    heading = heading_from_keypoints(keypoints)
    if heading:
        attributes["headingVec"] = {"x": heading[0], "y": heading[1]}
        attributes["headingDeg"] = heading[2]
    return attributes
