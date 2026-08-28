"""Run one analysis job through the pipeline (Phase 6)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.jobs.queue import AnalysisJob
from app.pipeline.run import run_pipeline

logger = logging.getLogger(__name__)


def process_job(job: AnalysisJob, *, device: str | None = None) -> dict[str, Any]:
    """
    Execute pipeline for a claimed job.

    Payload may include:
      - source_file_name
      - project_id
      - image_path (local) or storage_path
      - mm_per_pixel, regions (optional — for policy-only)
    """
    settings = get_settings()
    if device:
        # Device is already on settings; worker may override via env before import.
        pass

    payload = dict(job.payload or {})
    project_id = str(payload.get("project_id") or job.owner_id or "local")
    source = str(payload.get("source_file_name") or job.storage_path or f"{job.analysis_id}.pdf")
    image_bytes: bytes | None = None
    image_path = payload.get("image_path")
    if image_path and Path(str(image_path)).is_file():
        image_bytes = Path(str(image_path)).read_bytes()

    mm = payload.get("mm_per_pixel")
    mm_per_pixel = float(mm) if mm is not None else None

    result = run_pipeline(
        analysis_id=job.analysis_id,
        project_id=project_id,
        source_file_name=source,
        settings=settings,
        image_bytes=image_bytes,
        mm_per_pixel=mm_per_pixel,
        calibration_verified=bool(payload.get("calibration_verified")),
        entity_statuses=payload.get("entity_statuses"),
    )
    return result.model_dump(mode="json")
