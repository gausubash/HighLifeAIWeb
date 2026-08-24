from __future__ import annotations

# YOLO class index order. Keep stable — labels/*.txt and the trained .pt depend on it.
CLASS_NAMES: tuple[str, ...] = (
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
)

CLASS_TO_ID: dict[str, int] = {name: i for i, name in enumerate(CLASS_NAMES)}

# Rare / alias labels in the LabelMe dump → YOLO class.
LABEL_ALIASES: dict[str, str] = {
    "Living": "Open Living",
    "Toilet": "Bathroom",
    "Double Door": "Single Door",
    "Home Office": "Bedroom",
}

def _norm_label(label: str) -> str:
    return " ".join((label or "").strip().lower().replace("_", " ").replace("-", " ").split())


LABEL_TO_ENTITY_TYPE: dict[str, str] = {
    "Unit": "unit_boundary",
    "Open Living": "room",
    "Bedroom": "room",
    "Bathroom": "room",
    "Ensuite": "room",
    "Laundry": "room",
    "Closet": "room",
    "Store": "room",
    "Balcony": "room",
    "Lobby": "room",
    "Communal Space": "room",
    "Wall": "wall",
    "External Wall": "wall",
    "Single Door": "door",
    "Sliding Door": "door",
    "Main Door": "door",
    "Window": "window",
    "Stair": "stair",
    "Lift": "other",
    "drawing_area": "main_floorplan",
    "legend_block": "legend",
    "title_block": "title_block",
    "Drawing area": "main_floorplan",
    "Legend": "legend",
    "Title block": "title_block",
    # FloorPlanCAD / SamirShabani/Architect
    "single door": "door",
    "double door": "door",
    "sliding door": "door",
    "window": "window",
    "bay window": "window",
    "blind window": "window",
    "opening symbol": "door",
    "stair": "stair",
    "gas stove": "room",
    "refrigerator": "room",
    "washing machine": "room",
    "sofa": "room",
    "bed": "room",
    "chair": "fixture",
    "table": "fixture",
    "bedside cupboard": "room",
    "TV cabinet": "room",
    "half-height cabinet": "fixture",
    "high cabinet": "fixture",
    "wardrobe": "room",
    "sink": "room",
    "bath": "room",
    "bath tub": "room",
    "squat toilet": "room",
    "urinal": "room",
    "toilet": "room",
    "elevator": "other",
    "escalator": "other",
    "walls": "wall",
    "wall": "wall",
    "partition": "wall",
    "interior wall": "wall",
    "floor": "room",
    "room": "room",
    "rooms": "room",
    "door": "door",
    "doors": "door",
    "windows": "window",
}

DISPLAY_LABELS: dict[str, str] = {
    "drawing_area": "Drawing area",
    "legend_block": "Legend",
    "title_block": "Title block",
}

ROOM_TYPE_ATTR: dict[str, str] = {
    "Unit": "unit",
    "Open Living": "living",
    "Bedroom": "bedroom",
    "Bathroom": "bathroom",
    "Ensuite": "bathroom",
    "Laundry": "laundry",
    "Closet": "closet",
    "Store": "store",
    "Balcony": "balcony",
    "Lobby": "lobby",
    "Communal Space": "common_corridor",
    "drawing_area": "drawing_area",
    "Drawing area": "drawing_area",
    "legend_block": "legend",
    "Legend": "legend",
    "title_block": "title_block",
    "Title block": "title_block",
    "gas stove": "kitchen",
    "refrigerator": "kitchen",
    "washing machine": "laundry",
    "sofa": "living",
    "bed": "bedroom",
    "chair": "living",
    "table": "living",
    "bedside cupboard": "bedroom",
    "TV cabinet": "living",
    "wardrobe": "closet",
    "sink": "bathroom",
    "bath": "bathroom",
    "bath tub": "bathroom",
    "squat toilet": "bathroom",
    "urinal": "bathroom",
    "toilet": "bathroom",
}

_ENTITY_BY_NORM = {_norm_label(key): value for key, value in LABEL_TO_ENTITY_TYPE.items()}
_ROOM_BY_NORM = {_norm_label(key): value for key, value in ROOM_TYPE_ATTR.items()}


def canonical_label(raw: str) -> str | None:
    name = (raw or "").strip()
    if not name:
        return None
    mapped = LABEL_ALIASES.get(name, name)
    if mapped in CLASS_TO_ID:
        return mapped
    return None


def entity_type_for(label: str) -> str:
    if label in LABEL_TO_ENTITY_TYPE:
        return LABEL_TO_ENTITY_TYPE[label]
    return _ENTITY_BY_NORM.get(_norm_label(label), "other")


def display_label(raw: str) -> str:
    name = (raw or "").strip()
    return DISPLAY_LABELS.get(name, name.replace("_", " ").title() if name else "Region")


def room_type_for(label: str) -> str:
    if label in ROOM_TYPE_ATTR:
        return ROOM_TYPE_ATTR[label]
    return _ROOM_BY_NORM.get(_norm_label(label), _norm_label(label).replace(" ", "_"))
