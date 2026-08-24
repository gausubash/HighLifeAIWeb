from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import AnalysisRunRow, ArtifactRow, PlanDocumentRow, PlanPageRow, get_session, utcnow
from app.detect.pipeline import detect_page_regions
from app.detect.to_graph import detect_result_to_scene_graph
from app.errors import ApiError
from app.mock import mock_apartment_scene_graph
from app.schemas.domain import AnalysisRunCreate, AnalysisRunOut
from app.schemas.scene_graph import FloorPlanSceneGraph, new_id
from app.storage import resolve_storage_path

router = APIRouter(prefix="/api", tags=["analysis"])


def _run_out(row: AnalysisRunRow) -> AnalysisRunOut:
    return AnalysisRunOut(
        id=row.id,
        planDocumentId=row.plan_document_id,
        pageId=row.page_id,
        profile=row.profile,
        status=row.status,
        warning=row.warning,
        createdAt=row.created_at.isoformat().replace("+00:00", "Z"),
        updatedAt=row.updated_at.isoformat().replace("+00:00", "Z"),
    )


@router.post("/plans/{plan_id}/analysis-runs", response_model=AnalysisRunOut)
def create_analysis_run(
    plan_id: str,
    body: AnalysisRunCreate,
    db: Session = Depends(get_session),
) -> AnalysisRunOut:
    doc = db.get(PlanDocumentRow, plan_id)
    if doc is None:
        raise ApiError("PLAN_NOT_FOUND", "Plan document not found.", status_code=404)
    page = db.get(PlanPageRow, body.pageId)
    if page is None or page.plan_document_id != plan_id:
        raise ApiError("PAGE_NOT_FOUND", "Page not found on this plan.", status_code=404)

    run_id = new_id()
    warning: str | None
    if body.profile == "manual_demo":
        graph = mock_apartment_scene_graph(
            project_id=doc.project_id,
            plan_document_id=plan_id,
            page_id=page.id,
            analysis_run_id=run_id,
        )
        warning = "Mock analysis: no computer vision ran. Geometry is schema-valid sample data."
    else:
        if not page.raster_artifact_id:
            raise ApiError("ARTIFACT_NOT_FOUND", "Page image artefact is missing.", status_code=404)
        artifact = db.get(ArtifactRow, page.raster_artifact_id)
        if artifact is None:
            raise ApiError("ARTIFACT_NOT_FOUND", "Page image artefact is missing.", status_code=404)
        raster_path = resolve_storage_path(artifact.storage_path)
        if not raster_path.is_file():
            raise ApiError("ARTIFACT_MISSING_FILE", "Stored image file was not found.", status_code=404)
        detected = detect_page_regions(
            raster_path.read_bytes(),
            original_width=page.width_px,
            original_height=page.height_px,
        )
        graph = detect_result_to_scene_graph(
            detected,
            project_id=doc.project_id,
            plan_document_id=plan_id,
            page_id=page.id,
            analysis_run_id=run_id,
        )
        warning = detected.warning
    now = utcnow()
    row = AnalysisRunRow(
        id=run_id,
        plan_document_id=plan_id,
        page_id=page.id,
        profile=body.profile,
        status="succeeded",
        warning=warning,
        scene_graph_json=graph.model_dump_json(by_alias=True),
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _run_out(row)


@router.get("/analysis-runs/{run_id}", response_model=AnalysisRunOut)
def get_analysis_run(run_id: str, db: Session = Depends(get_session)) -> AnalysisRunOut:
    row = db.get(AnalysisRunRow, run_id)
    if row is None:
        raise ApiError("ANALYSIS_RUN_NOT_FOUND", "Analysis run not found.", status_code=404)
    return _run_out(row)


@router.get("/analysis-runs/{run_id}/scene-graph", response_model=FloorPlanSceneGraph)
def get_scene_graph(run_id: str, db: Session = Depends(get_session)) -> FloorPlanSceneGraph:
    row = db.get(AnalysisRunRow, run_id)
    if row is None:
        raise ApiError("ANALYSIS_RUN_NOT_FOUND", "Analysis run not found.", status_code=404)
    return FloorPlanSceneGraph.model_validate_json(row.scene_graph_json)
