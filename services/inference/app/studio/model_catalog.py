"""Model Studio categories and pretrained fine-tune bases."""

from __future__ import annotations

from pathlib import Path

from app.yolo.predict import (
    HF_LAYOUT_WEIGHTS,
    HF_ROOM_WEIGHTS,
    HF_WALL_WEIGHTS,
    default_room_weights_path,
    default_wall_weights_path,
    default_weights_path,
    is_remote_weights,
    layout_weights_source,
    resolve_room_weights,
    resolve_wall_weights,
)

LAYOUT_BASE_ID = "yolo_layout.pt"
WALL_YOLO_BASE_ID = "yolo_walls_obb.pt"
ROOM_BASE_ID = "yolo_room.pt"

_LAYOUT_ALIASES = frozenset(
    {
        "yolo_layout.pt",
        "layout:greenmap",
        "yolo11x-blueprint-layout-detector",
    }
)
_WALL_YOLO_ALIASES = frozenset(
    {
        "yolo_walls_obb.pt",
        "wall:yolo",
        "yolo11x-blueprint-wall-detector",
    }
)
_ROOM_ALIASES = frozenset(
    {
        "yolo_room.pt",
        "architect_floorplan.pt",
        "architect-floorplan-cad",
        "samirshabani/architect",
    }
)

CATEGORY_LAYOUT = "layout_analysis"
CATEGORY_WALL_DETECT = "wall_detection"
CATEGORY_ROOM_DETECT = "room_detection"
CATEGORY_WALL_SEGMENT = "wall_segmentation"
CATEGORY_GENERAL_DETECT = "general_detection"
CATEGORY_GENERAL_SEGMENT = "general_segmentation"

CATEGORY_LABELS: dict[str, str] = {
    CATEGORY_LAYOUT: "Layout analysis",
    CATEGORY_WALL_DETECT: "Wall detection",
    CATEGORY_ROOM_DETECT: "Room & fixture detection",
    CATEGORY_WALL_SEGMENT: "Wall segmentation",
    CATEGORY_GENERAL_DETECT: "General object detection",
    CATEGORY_GENERAL_SEGMENT: "General instance segmentation",
}

DATASET_CATEGORY_DEFAULTS: dict[str, dict[str, object]] = {
    CATEGORY_LAYOUT: {
        "task": "detect",
        "class_names": [
            "Title block",
            "Drawing area",
            "Legend block",
            "Drawing border",
            "Revision block",
        ],
        "default_base": LAYOUT_BASE_ID,
    },
    CATEGORY_WALL_DETECT: {
        "task": "detect",
        "class_names": ["Wall", "External Wall"],
        "default_base": WALL_YOLO_BASE_ID,
    },
    CATEGORY_ROOM_DETECT: {
        "task": "detect",
        "class_names": [
            "Unit",
            "Open Living",
            "Bedroom",
            "Bathroom",
            "Ensuite",
            "Laundry",
            "Closet",
            "Store",
            "Balcony",
            "Lobby",
            "Communal Space",
            "Wall",
            "External Wall",
            "Single Door",
            "Sliding Door",
            "Main Door",
            "Window",
            "Stair",
            "Lift",
        ],
        "default_base": ROOM_BASE_ID,
    },
    CATEGORY_WALL_SEGMENT: {
        "task": "segment",
        "class_names": ["Wall", "External Wall"],
        "default_base": "mitunet_walls.pth",
    },
    CATEGORY_GENERAL_DETECT: {
        "task": "detect",
        "class_names": ["Unit", "Bedroom", "Bathroom", "Wall", "Window", "Door"],
        "default_base": "yolov8n.pt",
    },
    CATEGORY_GENERAL_SEGMENT: {
        "task": "segment",
        "class_names": ["Wall", "External Wall", "Unit"],
        "default_base": "yolov8n-seg.pt",
    },
}


def _leaf(name: str) -> str:
    return (name or "").strip().lower().replace("\\", "/")


def is_layout_base(base_model: str) -> bool:
    leaf = _leaf(base_model).rsplit("/", 1)[-1]
    return leaf in _LAYOUT_ALIASES or "layout" in leaf and leaf.endswith(".pt")


def is_wall_yolo_base(base_model: str) -> bool:
    leaf = _leaf(base_model).rsplit("/", 1)[-1]
    return leaf in _WALL_YOLO_ALIASES or "walls_obb" in leaf


def is_room_base(base_model: str) -> bool:
    leaf = _leaf(base_model).rsplit("/", 1)[-1]
    return leaf in _ROOM_ALIASES or "architect" in leaf


def _weights_ready(resolved: str, local: Path, hf_url: str) -> tuple[bool, bool]:
    if resolved and not is_remote_weights(resolved) and Path(resolved).is_file():
        return True, True
    if local.is_file():
        return True, True
    if hf_url:
        return True, True
    return False, False


def resolve_pretrained_yolo_weights(base_id: str) -> str:
    """Return a local path or remote URL Ultralytics can load for domain YOLO bases."""
    if is_layout_base(base_id):
        return layout_weights_source()
    if is_wall_yolo_base(base_id):
        resolved = resolve_wall_weights()
        if resolved:
            return resolved
        local = default_wall_weights_path()
        if local.is_file():
            return str(local)
        return HF_WALL_WEIGHTS
    if is_room_base(base_id):
        resolved = resolve_room_weights()
        if resolved:
            return resolved
        local = default_room_weights_path()
        if local.is_file():
            return str(local)
        return HF_ROOM_WEIGHTS
    return base_id


def pretrained_base_meta(base_id: str) -> dict[str, object] | None:
    if is_layout_base(base_id):
        local = default_weights_path()
        resolved = layout_weights_source()
        ready, runnable = _weights_ready(resolved, local, HF_LAYOUT_WEIGHTS)
        return {
            "id": LAYOUT_BASE_ID,
            "name": "GreenMap layout (YOLO11x)",
            "task": "detect",
            "family": "greenmap",
            "category": CATEGORY_LAYOUT,
            "description": "Title block, drawing area, legend — yolo11x-blueprint-layout-detector.",
            "runnable": runnable,
            "ready": ready,
        }
    if is_wall_yolo_base(base_id):
        local = default_wall_weights_path()
        resolved = resolve_wall_weights() or (str(local) if local.is_file() else HF_WALL_WEIGHTS)
        ready, runnable = _weights_ready(resolved, local, HF_WALL_WEIGHTS)
        return {
            "id": WALL_YOLO_BASE_ID,
            "name": "GreenMap wall OBB (YOLO11x)",
            "task": "detect",
            "family": "greenmap",
            "category": CATEGORY_WALL_DETECT,
            "description": "Oriented wall boxes — yolo11x-blueprint-wall-detector.",
            "runnable": runnable,
            "ready": ready,
        }
    if is_room_base(base_id):
        local = default_room_weights_path()
        resolved = resolve_room_weights() or (str(local) if local.is_file() else HF_ROOM_WEIGHTS)
        ready, runnable = _weights_ready(resolved, local, HF_ROOM_WEIGHTS)
        return {
            "id": ROOM_BASE_ID,
            "name": "Architect room & fixtures (YOLO)",
            "task": "detect",
            "family": "architect",
            "category": CATEGORY_ROOM_DETECT,
            "description": "Rooms, doors, windows — SamirShabani/Architect.",
            "runnable": runnable,
            "ready": ready,
        }
    return None


def category_for_base(base_id: str, *, task: str, family: str) -> str:
    meta = pretrained_base_meta(base_id)
    if meta:
        return str(meta["category"])
    if family == "mitunet" or family == "floordata":
        return CATEGORY_WALL_SEGMENT
    if family == "mmdet":
        return CATEGORY_WALL_DETECT
    if task == "segment":
        return CATEGORY_GENERAL_SEGMENT
    return CATEGORY_GENERAL_DETECT


def default_base_for_category(category: str | None, task: str) -> str:
    if category and category in DATASET_CATEGORY_DEFAULTS:
        return str(DATASET_CATEGORY_DEFAULTS[category]["default_base"])
    return "yolov8n-seg.pt" if task == "segment" else "yolov8n.pt"
