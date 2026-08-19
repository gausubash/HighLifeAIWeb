"""Pipeline entry point — mock and real modes."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from app.config import RunMode, Settings, get_settings
from app.schemas import (
    AnalysisResultSchema,
    AnalysisStatus,
    ComplianceResultCategory,
    ComplianceResultSchema,
    OpeningSchema,
    PlanPageSchema,
    ReviewWarningSchema,
    SpaceSchema,
    UnitSchema,
    UnitSummarySchema,
)

FIXTURE_PATH = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "mock_result.json"


def _load_fixture() -> dict:
    with FIXTURE_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def _build_mock_result(
    analysis_id: str = "mock-analysis",
    project_id: str = "mock-project",
    source_file_name: str = "mock_floor_plan.pdf",
    settings: Settings | None = None,
) -> AnalysisResultSchema:
    settings = settings or get_settings()
    data = _load_fixture()
    data["analysis_id"] = analysis_id
    data["project_id"] = project_id
    data["source_file_name"] = source_file_name
    data["software_commit"] = settings.software_commit
    data["policy_version"] = settings.policy_version
    data["dataset_version"] = settings.dataset_version
    data["created_at"] = datetime.now(timezone.utc).isoformat()
    return AnalysisResultSchema.model_validate(data)


def run_pipeline(
    *,
    analysis_id: str,
    project_id: str,
    source_file_name: str,
    settings: Settings | None = None,
) -> AnalysisResultSchema:
    """
    Execute the analysis pipeline.

    Mock mode returns deterministic fixture output.
    Real mode is implemented in Phase 5–6.
    """
    settings = settings or get_settings()

    if settings.run_mode == RunMode.MOCK:
        return _build_mock_result(
            analysis_id=analysis_id,
            project_id=project_id,
            source_file_name=source_file_name,
            settings=settings,
        )

    raise NotImplementedError(
        "Real pipeline not yet implemented. Set RUN_MODE=mock for local development."
    )


# Re-export schema builders used by tests
__all__ = [
    "run_pipeline",
    "AnalysisResultSchema",
    "SpaceSchema",
    "UnitSchema",
    "OpeningSchema",
    "ComplianceResultSchema",
    "ComplianceResultCategory",
]
