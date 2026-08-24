from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.scene_graph import BoundingBox, Point


class DetectedRegionOut(BaseModel):
    id: str
    type: str
    label: str
    confidence: float
    polygonPx: list[Point]
    bboxPx: BoundingBox
    attributes: dict[str, object] = Field(default_factory=dict)


class DetectResponse(BaseModel):
    modelId: str
    modelVersion: str
    widthPx: int
    heightPx: int
    regions: list[DetectedRegionOut]
    warning: str | None = None
