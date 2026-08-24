from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field

SCENE_GRAPH_SCHEMA_VERSION = "1.0.0"

CoordinateSystem = Literal["original_image_px", "working_image_px", "world_mm"]
CalibrationMethod = Literal[
    "manual_two_point",
    "dimension_line",
    "scale_bar",
    "title_block_scale",
    "manual_scale_paper",
    "unknown",
]
EntityStatus = Literal["predicted", "user_confirmed", "user_edited", "rejected"]
PlanEntityType = Literal[
    "wall",
    "door",
    "window",
    "room",
    "unit_boundary",
    "column",
    "stair",
    "fixture",
    "text_label",
    "dimension",
    "title_block",
    "legend",
    "north_arrow",
    "scale_region",
    "notes",
    "other",
    "main_floorplan",
    "drawing_border",
    "revision_block",
]
RelationshipType = Literal[
    "room_adjacency",
    "room_door_access",
    "door_to_wall",
    "room_window_exterior",
    "unit_to_room",
    "room_label_assignment",
]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid4())


class Point(BaseModel):
    x: float
    y: float


class BoundingBox(BaseModel):
    x: float
    y: float
    width: float
    height: float


class MaskArtifactReference(BaseModel):
    artifact_id: str = Field(alias="artifactId")
    mime_type: str | None = Field(default=None, alias="mimeType")

    model_config = {"populate_by_name": True}


class CoordinateTransform(BaseModel):
    scale_x: float = Field(alias="scaleX")
    scale_y: float = Field(alias="scaleY")
    translate_x: float = Field(alias="translateX")
    translate_y: float = Field(alias="translateY")

    model_config = {"populate_by_name": True}


class Evidence(BaseModel):
    model_id: str = Field(alias="modelId")
    model_version: str = Field(alias="modelVersion")
    source_artifact_id: str = Field(alias="sourceArtifactId")
    confidence: float
    inferred_at: str = Field(alias="inferredAt")

    model_config = {"populate_by_name": True}


class PlanEntity(BaseModel):
    id: str
    type: PlanEntityType
    bbox_px: BoundingBox | None = Field(default=None, alias="bboxPx")
    polygon_px: list[Point] | None = Field(default=None, alias="polygonPx")
    polyline_px: list[Point] | None = Field(default=None, alias="polylinePx")
    attributes: dict[str, Any] = Field(default_factory=dict)
    confidence: float
    status: EntityStatus
    evidence: list[Evidence] = Field(default_factory=list)
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}


class EntityRelationship(BaseModel):
    id: str
    type: RelationshipType
    from_entity_id: str = Field(alias="fromEntityId")
    to_entity_id: str = Field(alias="toEntityId")
    confidence: float
    attributes: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class Measurement(BaseModel):
    id: str
    kind: Literal[
        "room_area",
        "room_perimeter",
        "opening_width",
        "wall_thickness",
        "min_room_width",
        "distance",
    ]
    source_geometry_ids: list[str] = Field(alias="sourceGeometryIds")
    calibration_id: str = Field(alias="calibrationId")
    value_px: float | None = Field(default=None, alias="valuePx")
    value_mm: float | None = Field(default=None, alias="valueMm")
    value_m: float | None = Field(default=None, alias="valueM")
    value_m2: float | None = Field(default=None, alias="valueM2")
    unit: str
    precision: int
    confidence: float
    formula: str | None = None
    estimated: bool = False

    model_config = {"populate_by_name": True}


class Calibration(BaseModel):
    id: str
    method: CalibrationMethod
    mm_per_pixel: float = Field(alias="mmPerPixel")
    confidence: float
    source_text: str | None = Field(default=None, alias="sourceText")
    source_geometry_px: list[Point] | None = Field(default=None, alias="sourceGeometryPx")
    verified_by_user: bool = Field(alias="verifiedByUser")
    active: bool = True
    created_at: str = Field(alias="createdAt")

    model_config = {"populate_by_name": True}


class FloorPlanSceneGraph(BaseModel):
    schema_version: str = Field(alias="schemaVersion")
    id: str
    project_id: str = Field(alias="projectId")
    plan_document_id: str = Field(alias="planDocumentId")
    page_id: str = Field(alias="pageId")
    analysis_run_id: str = Field(alias="analysisRunId")
    coordinate_systems: list[CoordinateSystem] = Field(alias="coordinateSystems")
    working_to_original: CoordinateTransform = Field(alias="workingToOriginal")
    calibration: Calibration | None = None
    entities: list[PlanEntity]
    relationships: list[EntityRelationship]
    measurements: list[Measurement]
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")

    model_config = {"populate_by_name": True}
