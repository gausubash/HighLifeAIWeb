from __future__ import annotations

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ProjectOut(BaseModel):
    id: str
    name: str
    createdAt: str
    updatedAt: str


class PlanDocumentOut(BaseModel):
    id: str
    projectId: str
    filename: str
    mimeType: str
    byteSize: int
    storagePath: str
    createdAt: str
    pages: list["PlanPageOut"] = Field(default_factory=list)


class PlanPageOut(BaseModel):
    id: str
    planDocumentId: str
    pageNumber: int
    widthPx: int
    heightPx: int
    dpi: int
    sourceFilename: str | None = None
    rasterArtifactId: str | None = None
    previewArtifactId: str | None = None
    originalImageUrl: str | None = None
    previewImageUrl: str | None = None


class AnalysisRunCreate(BaseModel):
    pageId: str
    profile: str = "layout_cpu"


class AnalysisRunOut(BaseModel):
    id: str
    planDocumentId: str
    pageId: str
    profile: str
    status: str
    warning: str | None = None
    createdAt: str
    updatedAt: str


PlanDocumentOut.model_rebuild()
