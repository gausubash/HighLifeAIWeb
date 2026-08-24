from __future__ import annotations

from pathlib import Path

from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import ArtifactRow, PlanDocumentRow, PlanPageRow, utcnow
from app.errors import ApiError
from app.raster import get_rasterizer
from app.schemas.scene_graph import new_id
from app.storage import save_bytes, storage_relative

EXT_MIME = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


def normalize_mime(declared: str | None, filename: str) -> str:
    mime = (declared or "").split(";")[0].strip().lower()
    if mime == "image/jpg":
        mime = "image/jpeg"
    if mime in {"application/pdf", "image/png", "image/jpeg", "image/webp"}:
        return mime
    guessed = EXT_MIME.get(Path(filename).suffix.lower())
    if guessed:
        return guessed
    return mime


def ingest_uploaded_plan(
    db: Session,
    *,
    project_id: str,
    filename: str,
    mime_type: str,
    data: bytes,
) -> tuple[PlanDocumentRow, list[PlanPageRow]]:
    settings = get_settings()
    plan_id = new_id()
    stored = save_bytes(f"plans/{plan_id}", filename, data)
    source_rel = storage_relative(stored)

    source_art = ArtifactRow(
        id=new_id(),
        analysis_run_id=None,
        kind="source_document",
        mime_type=mime_type,
        storage_path=source_rel,
        byte_size=len(data),
        created_at=utcnow(),
    )
    db.add(source_art)

    doc = PlanDocumentRow(
        id=plan_id,
        project_id=project_id,
        filename=filename,
        mime_type=mime_type,
        byte_size=len(data),
        storage_path=source_rel,
        created_at=utcnow(),
    )
    db.add(doc)

    try:
        pages_data = get_rasterizer().rasterize(
            stored,
            mime_type,
            dpi=settings.render_dpi,
            preview_max_edge=settings.preview_max_edge,
        )
    except Exception as exc:
        raise ApiError(
            "RASTERIZE_FAILED",
            "Could not rasterise the uploaded plan.",
            status_code=422,
            details={"reason": str(exc)},
        ) from exc

    if not pages_data:
        raise ApiError("EMPTY_DOCUMENT", "The document has no pages.", status_code=422)

    pages: list[PlanPageRow] = []
    for raster in pages_data:
        raster_art = ArtifactRow(
            id=new_id(),
            kind="page_raster",
            mime_type="image/png",
            storage_path="",
            byte_size=len(raster.raster_png),
            created_at=utcnow(),
        )
        preview_art = ArtifactRow(
            id=new_id(),
            kind="page_preview",
            mime_type="image/png",
            storage_path="",
            byte_size=len(raster.preview_png),
            created_at=utcnow(),
        )
        db.add(raster_art)
        db.add(preview_art)
        db.flush()

        raster_path = save_bytes(
            f"plans/{plan_id}/pages/{raster.page_number}",
            "raster.png",
            raster.raster_png,
        )
        preview_path = save_bytes(
            f"plans/{plan_id}/pages/{raster.page_number}",
            "preview.png",
            raster.preview_png,
        )
        raster_art.storage_path = storage_relative(raster_path)
        preview_art.storage_path = storage_relative(preview_path)

        page = PlanPageRow(
            id=new_id(),
            plan_document_id=plan_id,
            page_number=raster.page_number,
            width_px=raster.width_px,
            height_px=raster.height_px,
            dpi=raster.dpi,
            raster_artifact_id=raster_art.id,
            preview_artifact_id=preview_art.id,
        )
        db.add(page)
        pages.append(page)

    return doc, pages
