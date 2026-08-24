from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db import ArtifactRow, PlanDocumentRow, PlanPageRow, ProjectRow, get_session
from app.errors import ApiError
from app.ingest import ingest_uploaded_plan, normalize_mime
from app.schemas.domain import PlanDocumentOut, PlanPageOut
from app.storage import ALLOWED_MIME, MAX_UPLOAD_BYTES, resolve_storage_path

router = APIRouter(prefix="/api", tags=["plans"])


def _page_out(p: PlanPageRow, filename: str) -> PlanPageOut:
    return PlanPageOut(
        id=p.id,
        planDocumentId=p.plan_document_id,
        pageNumber=p.page_number,
        widthPx=p.width_px,
        heightPx=p.height_px,
        dpi=p.dpi,
        sourceFilename=filename,
        rasterArtifactId=p.raster_artifact_id,
        previewArtifactId=p.preview_artifact_id,
        originalImageUrl=f"/api/pages/{p.id}/image?variant=original",
        previewImageUrl=f"/api/pages/{p.id}/image?variant=preview",
    )


def _plan_out(doc: PlanDocumentRow, pages: list[PlanPageRow]) -> PlanDocumentOut:
    return PlanDocumentOut(
        id=doc.id,
        projectId=doc.project_id,
        filename=doc.filename,
        mimeType=doc.mime_type,
        byteSize=doc.byte_size,
        storagePath=doc.storage_path,
        createdAt=doc.created_at.isoformat().replace("+00:00", "Z"),
        pages=[_page_out(p, doc.filename) for p in pages],
    )


def _pages_for_plan(db: Session, plan_id: str) -> list[PlanPageRow]:
    return (
        db.query(PlanPageRow)
        .filter(PlanPageRow.plan_document_id == plan_id)
        .order_by(PlanPageRow.page_number)
        .all()
    )


@router.post("/plans/upload", response_model=PlanDocumentOut)
async def upload_plan(
    projectId: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_session),
) -> PlanDocumentOut:
    project = db.get(ProjectRow, projectId)
    if project is None:
        raise ApiError("PROJECT_NOT_FOUND", "Project not found.", status_code=404)

    filename = Path(file.filename or "plan.bin").name
    mime = normalize_mime(file.content_type, filename)
    if mime not in ALLOWED_MIME and mime != "image/jpeg":
        raise ApiError(
            "UNSUPPORTED_MEDIA_TYPE",
            "Upload must be PDF, PNG, JPEG, or WEBP.",
            status_code=415,
            details={"mimeType": mime},
        )

    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise ApiError("FILE_TOO_LARGE", "File exceeds 80 MB limit.", status_code=413)

    doc, pages = ingest_uploaded_plan(
        db,
        project_id=projectId,
        filename=filename,
        mime_type=mime,
        data=data,
    )
    db.commit()
    db.refresh(doc)
    for page in pages:
        db.refresh(page)
    return _plan_out(doc, pages)


@router.get("/plans/{plan_id}", response_model=PlanDocumentOut)
def get_plan(plan_id: str, db: Session = Depends(get_session)) -> PlanDocumentOut:
    doc = db.get(PlanDocumentRow, plan_id)
    if doc is None:
        raise ApiError("PLAN_NOT_FOUND", "Plan document not found.", status_code=404)
    return _plan_out(doc, _pages_for_plan(db, plan_id))


@router.get("/plans/{plan_id}/pages", response_model=list[PlanPageOut])
def list_plan_pages(plan_id: str, db: Session = Depends(get_session)) -> list[PlanPageOut]:
    doc = db.get(PlanDocumentRow, plan_id)
    if doc is None:
        raise ApiError("PLAN_NOT_FOUND", "Plan document not found.", status_code=404)
    return [_page_out(p, doc.filename) for p in _pages_for_plan(db, plan_id)]


@router.get("/pages/{page_id}/image")
def get_page_image(
    page_id: str,
    variant: str = "original",
    db: Session = Depends(get_session),
):
    if variant not in {"original", "preview"}:
        raise ApiError(
            "INVALID_VARIANT",
            "variant must be original or preview.",
            status_code=400,
            details={"variant": variant},
        )
    page = db.get(PlanPageRow, page_id)
    if page is None:
        raise ApiError("PAGE_NOT_FOUND", "Page not found.", status_code=404)
    artifact_id = page.raster_artifact_id if variant == "original" else page.preview_artifact_id
    if not artifact_id:
        raise ApiError("ARTIFACT_NOT_FOUND", "Page image artefact is missing.", status_code=404)
    artifact = db.get(ArtifactRow, artifact_id)
    if artifact is None:
        raise ApiError("ARTIFACT_NOT_FOUND", "Page image artefact is missing.", status_code=404)
    path = resolve_storage_path(artifact.storage_path)
    if not path.is_file():
        raise ApiError("ARTIFACT_MISSING_FILE", "Stored image file was not found.", status_code=404)
    return FileResponse(path, media_type="image/png", filename=path.name)
