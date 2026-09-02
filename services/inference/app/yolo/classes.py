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

ROOM_TYPE_CLASS_NAMES: tuple[str, ...] = (
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
)
OBJECT_CLASS_NAMES: tuple[str, ...] = (
    "Single Door",
    "Sliding Door",
    "Main Door",
    "Window",
    "Stair",
    "Lift",
)
ROOM_TYPE_ENTITY_TYPES: frozenset[str] = frozenset({"room", "unit_boundary"})
STRUCTURAL_ENTITY_TYPES: frozenset[str] = frozenset({"wall", "door", "window"})
OPENING_ENTITY_TYPES: frozenset[str] = frozenset({"door", "window"})
FIXTURE_ENTITY_TYPES: frozenset[str] = frozenset({"stair", "fixture", "other"})
OBJECT_ENTITY_TYPES: frozenset[str] = OPENING_ENTITY_TYPES | FIXTURE_ENTITY_TYPES
WALL_ENTITY_TYPES: frozenset[str] = frozenset({"wall"})


def region_matches_detect_task(entity_type: str, task: str) -> bool:
    kind = (entity_type or "").strip().lower()
    mode = (task or "walls").strip().lower()
    if mode in {"rooms", "room_types"}:
        return kind in ROOM_TYPE_ENTITY_TYPES
    if mode in {"openings", "opening_detection"}:
        return kind in OPENING_ENTITY_TYPES
    if mode in {"structural", "structural_detection"}:
        return kind in STRUCTURAL_ENTITY_TYPES
    if mode in {"objects", "object_detection"}:
        return kind in FIXTURE_ENTITY_TYPES
    if mode in {"walls", "wall_segmentation"}:
        return kind in WALL_ENTITY_TYPES
    if mode in {"north", "north_arrow"}:
        return kind == "north_arrow"
    return True

# Rare / alias labels in the LabelMe dump → YOLO class.
LABEL_ALIASES: dict[str, str] = {
    "Living": "Open Living",
    "Toilet": "Bathroom",
    "Double Door": "Single Door",
    "Home Office": "Bedroom",
    "North": "North Arrow",
    "north": "North Arrow",
    "Compass": "North Arrow",
    "compass": "North Arrow",
    "north arrow": "North Arrow",
    "North arrow": "North Arrow",
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
    "north_arrow": "north_arrow",
    "north arrow": "north_arrow",
    "North Arrow": "north_arrow",
    "North arrow": "north_arrow",
    "compass": "north_arrow",
    "Compass": "north_arrow",
    "north": "north_arrow",
    "North": "north_arrow",
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
    "internal wall": "wall",
    "external wall": "wall",
    "floor": "room",
    "room": "room",
    "rooms": "room",
    "door": "door",
    "doors": "door",
    "windows": "window",
    # Roboflow floorplan-cvjp0/floorplan-9fxye (office room instances)
    "company-area": "room",
    "company area": "room",
    "conference": "room",
    "reception": "room",
    "Rest-room": "room",
    "rest-room": "room",
    "rest room": "room",
    "restroom": "room",
    "waiting": "room",
}

DISPLAY_LABELS: dict[str, str] = {
    "drawing_area": "Drawing area",
    "legend_block": "Legend",
    "title_block": "Title block",
    "north_arrow": "North arrow",
    "north arrow": "North arrow",
    "compass": "Compass",
    "north": "North arrow",
    "company-area": "Company area",
    "Rest-room": "Rest room",
    "rest-room": "Rest room",
    "restroom": "Rest room",
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
    "north_arrow": "north_arrow",
    "north arrow": "north_arrow",
    "North Arrow": "north_arrow",
    "North arrow": "north_arrow",
    "compass": "north_arrow",
    "Compass": "north_arrow",
    "north": "north_arrow",
    "North": "north_arrow",
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
    "company-area": "office",
    "company area": "office",
    "conference": "conference",
    "reception": "lobby",
    "Rest-room": "bathroom",
    "rest-room": "bathroom",
    "rest room": "bathroom",
    "restroom": "bathroom",
    "waiting": "waiting",
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


def opening_type_for(label: str) -> str | None:
    """Main Door → unit_entrance; other doors → internal_room_door; windows → window."""
    et = entity_type_for(label)
    if et == "window":
        return "window"
    if et != "door":
        return None
    n = _norm_label(label)
    if n == "main door" or n.endswith("main door"):
        return "unit_entrance"
    return "internal_room_door"
