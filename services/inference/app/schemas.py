"""Pydantic schemas for pipeline boundaries."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class AnalysisStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    REVIEW_REQUIRED = "review_required"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ComplianceResultCategory(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    UNCERTAIN = "uncertain"
    NOT_APPLICABLE = "not_applicable"
    NOT_IMPLEMENTED = "not_implemented"


Polygon = list[list[float]]


class SpaceSchema(BaseModel):
    id: str
    external_id: str
    space_type: str
    unit_id: str | None = None
    geometry: Polygon
    area_m2: float | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    review_required: bool = False
    is_common: bool = False


class UnitSchema(BaseModel):
    id: str
    external_id: str
    geometry: Polygon
    area_m2: float | None = None
    entrance_ids: list[str] = Field(default_factory=list)
    space_ids: list[str] = Field(default_factory=list)
    confidence: float = Field(ge=0.0, le=1.0)
    review_required: bool = False


class OpeningSchema(BaseModel):
    id: str
    external_id: str
    opening_type: str
    geometry: Polygon
    from_space_id: str | None = None
    to_space_id: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)


class PlanPageSchema(BaseModel):
    id: str
    page_number: int
    image_path: str
    width_px: int
    height_px: int
    is_floor_plan: bool = True
    scale_m_per_pixel: float | None = None
    scale_source: str | None = None
    scale_confidence: float | None = None
    document_id: str | None = None
    source_file_name: str | None = None
    level_name: str | None = None
    level_index: int | None = None
    floor_id: str | None = None


class HierarchyObjectSchema(BaseModel):
    id: str
    kind: str
    label: str
    parent_room_id: str | None = None
    parent_unit_id: str | None = None
    confidence: float = Field(ge=0.0, le=1.0)


class HierarchyRoomSchema(BaseModel):
    id: str
    label: str
    room_type: str
    unit_id: str | None = None
    is_common: bool = False
    area_m2: float | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    object_ids: list[str] = Field(default_factory=list)


class HierarchyUnitSchema(BaseModel):
    id: str
    label: str
    area_m2: float | None = None
    room_ids: list[str] = Field(default_factory=list)
    bedroom_count: int = 0
    bathroom_count: int = 0
    confidence: float = Field(ge=0.0, le=1.0)
    review_required: bool = False


class HierarchyFloorSchema(BaseModel):
    id: str
    level_name: str
    level_index: int
    page_id: str
    page_number: int
    document_id: str | None = None
    source_file_name: str | None = None
    is_floor_plan: bool = True
    unit_ids: list[str] = Field(default_factory=list)
    common_area_ids: list[str] = Field(default_factory=list)
    unassigned_room_ids: list[str] = Field(default_factory=list)
    properties: dict[str, Any] = Field(default_factory=dict)


class BuildingHierarchySchema(BaseModel):
    schema_version: str = "1.0.0"
    building_id: str
    project_id: str
    analysis_id: str
    name: str
    floors: list[HierarchyFloorSchema] = Field(default_factory=list)
    units: list[HierarchyUnitSchema] = Field(default_factory=list)
    rooms: list[HierarchyRoomSchema] = Field(default_factory=list)
    objects: list[HierarchyObjectSchema] = Field(default_factory=list)
    created_at: datetime | str | None = None
    updated_at: datetime | str | None = None


class ComplianceResultSchema(BaseModel):
    id: str
    analysis_id: str
    unit_external_id: str
    rule_code: str
    policy_version: str
    result: ComplianceResultCategory
    measured_value: float | None = None
    required_value: float | None = None
    unit: str | None = None
    explanation: str
    evidence: dict[str, Any] | None = None
    confidence: float = Field(ge=0.0, le=1.0)
    created_at: datetime


class ReviewWarningSchema(BaseModel):
    code: str
    message: str
    object_id: str | None = None
    object_type: str | None = None
    severity: str = "warning"


class UnitSummarySchema(BaseModel):
    unit_id: str
    area_m2: float
    room_count: int
    bedroom_count: int
    bathroom_count: int
    private_open_space_area_m2: float
    confidence: float
    review_status: str


class AnalysisResultSchema(BaseModel):
    analysis_id: str
    project_id: str
    source_file_name: str
    software_commit: str
    model_versions: dict[str, str]
    policy_version: str
    dataset_version: str
    created_at: datetime
    status: AnalysisStatus
    current_stage: str
    pages: list[PlanPageSchema]
    spaces: list[SpaceSchema]
    openings: list[OpeningSchema]
    units: list[UnitSchema]
    hierarchy: BuildingHierarchySchema | None = None
    compliance_results: list[ComplianceResultSchema]
    unit_summaries: list[UnitSummarySchema]
    review_warnings: list[ReviewWarningSchema]
