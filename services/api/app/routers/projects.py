from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import ProjectRow, get_session, utcnow
from app.errors import ApiError
from app.schemas.domain import ProjectCreate, ProjectOut
from app.schemas.scene_graph import new_id

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _out(row: ProjectRow) -> ProjectOut:
    return ProjectOut(
        id=row.id,
        name=row.name,
        createdAt=row.created_at.isoformat().replace("+00:00", "Z"),
        updatedAt=row.updated_at.isoformat().replace("+00:00", "Z"),
    )


@router.post("", response_model=ProjectOut)
def create_project(body: ProjectCreate, db: Session = Depends(get_session)) -> ProjectOut:
    row = ProjectRow(id=new_id(), name=body.name.strip(), created_at=utcnow(), updated_at=utcnow())
    db.add(row)
    db.commit()
    db.refresh(row)
    return _out(row)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, db: Session = Depends(get_session)) -> ProjectOut:
    row = db.get(ProjectRow, project_id)
    if row is None:
        raise ApiError("PROJECT_NOT_FOUND", "Project not found.", status_code=404)
    return _out(row)
