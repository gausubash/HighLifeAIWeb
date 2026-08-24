from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from app.config import get_settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class ProjectRow(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PlanDocumentRow(Base):
    __tablename__ = "plan_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    filename: Mapped[str] = mapped_column(String(512))
    mime_type: Mapped[str] = mapped_column(String(128))
    byte_size: Mapped[int] = mapped_column(Integer)
    storage_path: Mapped[str] = mapped_column(String(1024))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PlanPageRow(Base):
    __tablename__ = "plan_pages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    plan_document_id: Mapped[str] = mapped_column(ForeignKey("plan_documents.id"))
    page_number: Mapped[int] = mapped_column(Integer)
    width_px: Mapped[int] = mapped_column(Integer)
    height_px: Mapped[int] = mapped_column(Integer)
    dpi: Mapped[int] = mapped_column(Integer, default=350)
    raster_artifact_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    preview_artifact_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class AnalysisRunRow(Base):
    __tablename__ = "analysis_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    plan_document_id: Mapped[str] = mapped_column(ForeignKey("plan_documents.id"))
    page_id: Mapped[str] = mapped_column(ForeignKey("plan_pages.id"))
    profile: Mapped[str] = mapped_column(String(64), default="manual_demo")
    status: Mapped[str] = mapped_column(String(32), default="succeeded")
    warning: Mapped[str | None] = mapped_column(Text, nullable=True)
    scene_graph_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ArtifactRow(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    analysis_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    kind: Mapped[str] = mapped_column(String(64))
    mime_type: Mapped[str] = mapped_column(String(128))
    storage_path: Mapped[str] = mapped_column(String(1024))
    byte_size: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CalibrationRow(Base):
    __tablename__ = "calibrations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    analysis_run_id: Mapped[str] = mapped_column(ForeignKey("analysis_runs.id"))
    method: Mapped[str] = mapped_column(String(64))
    mm_per_pixel: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float)
    verified_by_user: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[int] = mapped_column(Integer, default=1)


SessionLocal = None
_engine = None


def init_db() -> None:
    global SessionLocal, _engine
    settings = get_settings()
    Path("./data").mkdir(parents=True, exist_ok=True)
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    _engine = create_engine(
        settings.database_url,
        connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
    )
    Base.metadata.create_all(_engine)
    SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False)


def get_session():
    if SessionLocal is None:
        init_db()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
