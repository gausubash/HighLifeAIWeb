"""Catalog of models available for POST /v1/detect.

Detect is task-split: wall segmentation (MitUNet or ArchVision Roboflow), room types, and objects.
Layout stays on the Layout tab (`layout:greenmap`).
"""

from __future__ import annotations

from app.config import Settings, get_settings
from app.yolo.mitunet import mitunet_ready
from app.yolo.predict import room_yolo_ready, yolo_ready
from app.studio.local_store import StudioStoreError, list_models, model_weights_path
from app.studio.model_catalog import (
    CATEGORY_LAYOUT,
    CATEGORY_OBJECT_DETECT,
    CATEGORY_OPENING_DETECT,
    CATEGORY_ROOM_TYPES,
    CATEGORY_STRUCTURAL_DETECT,
    CATEGORY_WALL_SEGMENT,
    normalize_category,
)

WALL_BACKEND = "mitunet"


def parse_detect_model(value: str | None) -> tuple[str | None, str | None, str | None, str]:
    """Return (studio_model_id, wall_backend, layout_backend, detect_task)."""
    raw = (value or "").strip()
    if not raw:
        return None, None, None, "walls"
    if raw.startswith("studio:"):
        return raw.removeprefix("studio:").strip() or None, None, None, "studio"
    if raw.startswith("room:"):
        return None, None, None, "rooms"
    if raw.startswith("object:"):
        return None, None, None, "objects"
    if raw.startswith("opening:"):
        opening_backend = raw.removeprefix("opening:").strip() or "architect"
        if opening_backend in {"roboflow-seg", "roboflow_seg"}:
            return None, None, None, "structural"
        return None, None, None, "openings"
    if raw.startswith("structural:"):
        return None, None, None, "structural"
    if raw.startswith("wall:"):
        backend = raw.removeprefix("wall:").strip() or WALL_BACKEND
        if backend in {"roboflow-seg", "roboflow_seg"}:
            return None, None, None, "structural"
        return None, backend, None, "walls"
    if raw.startswith("symbol:") or raw.startswith("north:"):
        return None, None, None, "north"
    if raw.startswith("layout:"):
        return None, None, raw.removeprefix("layout:").strip() or "greenmap", "layout"
    if len(raw) == 36 and raw.count("-") == 4:
        return raw, None, None, "studio"
    return None, raw, None, "walls"


def room_backend_from_token(value: str | None) -> str:
    raw = (value or "").strip()
    if raw.startswith("room:"):
        return raw.removeprefix("room:").strip() or "architect"
    return "architect"


def opening_backend_from_token(value: str | None) -> str:
    raw = (value or "").strip()
    if raw.startswith("opening:"):
        return raw.removeprefix("opening:").strip() or "architect"
    return "architect"


def detect_model_token(
    *,
    studio_id: str | None = None,
    wall_backend: str | None = None,
    detect_task: str | None = None,
) -> str:
    if studio_id:
        return f"studio:{studio_id}"
    task = (detect_task or "").strip().lower()
    if task in {"rooms", "room_types"}:
        return "room:architect"
    if task == "roboflow_rooms":
        return "room:roboflow"
    if task in {"objects", "object_detection"}:
        return "object:architect"
    if task in {"structural", "structural_detection"}:
        return "structural:roboflow-seg"
    if wall_backend:
        return f"wall:{wall_backend}"
    return f"wall:{WALL_BACKEND}"


def list_detect_models(settings: Settings | None = None) -> list[dict[str, object]]:
    settings = settings or get_settings()
    items: list[dict[str, object]] = []

    mit_ready = mitunet_ready(settings.model_copy(update={"wall_backend": WALL_BACKEND}))
    items.append(
        {
            "id": "wall:mitunet",
            "name": "MitUNet wall masks",
            "kind": "builtin",
            "task": "segment",
            "category": CATEGORY_WALL_SEGMENT,
            "description": "Mix-Transformer B4 + U-Net — the wall segmentation model.",
            "ready": mit_ready,
            "runnable": mit_ready,
            "active": True,
        }
    )
    from app.yolo.roboflow import roboflow_wall_ready

    rf_walls_ready = roboflow_wall_ready(settings)
    from app.yolo.roboflow import roboflow_floorplan_seg_ready

    rf_seg_ready = roboflow_floorplan_seg_ready(settings)
    items.append(
        {
            "id": "structural:roboflow-seg",
            "name": "Roboflow floorplan segmentation",
            "kind": "builtin",
            "task": "segment",
            "category": CATEGORY_STRUCTURAL_DETECT,
            "description": (
                "Universe floorplan-lfnvy/floorplan-segmentation-imdze — walls, doors, and "
                "windows in one pass. Used as the structural boundary head for unit inference "
                "when OCR unit names are unavailable."
            ),
            "ready": rf_seg_ready,
            "runnable": rf_seg_ready,
            "active": False,
        }
    )
    items.append(
        {
            "id": "wall:roboflow",
            "name": "ArchVision wall detect",
            "kind": "builtin",
            "task": "segment",
            "category": CATEGORY_WALL_SEGMENT,
            "description": (
                "Universe walldetection-iekzl/archvision_wall_detect — wall instances "
                "from architectural drawings. Needs ROBOFLOW_API_KEY "
                "(or cached weights for archvision_wall_detect)."
            ),
            "ready": rf_walls_ready,
            "runnable": rf_walls_ready,
            "active": False,
        }
    )

    rooms_ready = room_yolo_ready(settings)
    items.append(
        {
            "id": "room:architect",
            "name": "Architect room types",
            "kind": "builtin",
            "task": "detect",
            "category": CATEGORY_ROOM_TYPES,
            "description": "Bedroom, bathroom, living, unit boundaries (Architect YOLO).",
            "ready": rooms_ready,
            "runnable": rooms_ready,
            "active": False,
        }
    )
    from app.yolo.roboflow import roboflow_room_ready

    rf_rooms_ready = roboflow_room_ready(settings)
    items.append(
        {
            "id": "room:roboflow",
            "name": "Roboflow office rooms",
            "kind": "builtin",
            "task": "segment",
            "category": CATEGORY_ROOM_TYPES,
            "description": (
                "Universe floorplan-9fxye instance masks: company area, conference, "
                "reception, rest room, waiting, room. Needs ROBOFLOW_API_KEY."
            ),
            "ready": rf_rooms_ready,
            "runnable": rf_rooms_ready,
            "active": False,
        }
    )
    items.append(
        {
            "id": "object:architect",
            "name": "Architect fixtures",
            "kind": "builtin",
            "task": "detect",
            "category": CATEGORY_OBJECT_DETECT,
            "description": "Stairs and lifts (Architect YOLO).",
            "ready": rooms_ready,
            "runnable": rooms_ready,
            "active": False,
        }
    )
    items.append(
        {
            "id": "opening:architect",
            "name": "Architect openings",
            "kind": "builtin",
            "task": "detect",
            "category": CATEGORY_OPENING_DETECT,
            "description": "Doors and windows (Architect YOLO).",
            "ready": rooms_ready,
            "runnable": rooms_ready,
            "active": False,
        }
    )
    items.append(
        {
            "id": "symbol:north",
            "name": "North arrow (heading)",
            "kind": "builtin",
            "task": "detect",
            "category": "north_arrow",
            "description": (
                "Oriented north-arrow detector (OBB or tail→tip). Train in Model Studio; "
                "aspect uses the heading, not OCR."
            ),
            "ready": False,
            "runnable": False,
            "active": False,
        }
    )

    if yolo_ready(settings):
        items.append(
            {
                "id": "layout:greenmap",
                "name": "GreenMap layout (title / legend / drawing)",
                "kind": "layout",
                "task": "detect",
                "category": CATEGORY_LAYOUT,
                "description": "YOLO11x blueprint layout regions.",
                "ready": True,
                "runnable": True,
                "active": False,
            }
        )

    for model in list_models():
        model_id = str(model.get("id") or "")
        if not model_id:
            continue
        try:
            weights = model_weights_path(model_id)
            ready = weights.is_file()
        except StudioStoreError:
            ready = False
        category = normalize_category(str(model.get("category") or "") or None)
        items.append(
            {
                "id": detect_model_token(studio_id=model_id),
                "name": str(model.get("name") or model_id),
                "kind": "studio",
                "task": str(model.get("task") or "detect"),
                "category": category or CATEGORY_OBJECT_DETECT,
                "description": str(model.get("architecture") or "Fine-tuned in Model Studio"),
                "ready": ready,
                "runnable": ready,
                "active": bool(model.get("is_active")),
                "class_names": list(model.get("class_names") or []),
            }
        )

    return items


def default_detect_model(settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    if mitunet_ready(settings.model_copy(update={"wall_backend": WALL_BACKEND})):
        return "wall:mitunet"
    for item in list_detect_models(settings):
        if item.get("runnable") and str(item.get("id") or "").startswith("wall:"):
            return str(item["id"])
    for item in list_detect_models(settings):
        if item.get("runnable"):
            return str(item["id"])
    return "wall:mitunet"
