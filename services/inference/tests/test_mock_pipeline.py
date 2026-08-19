"""Mock pipeline tests — run locally without GPU."""

import pytest

from app.config import RunMode, Settings
from app.pipeline.run import run_pipeline


@pytest.fixture
def mock_settings() -> Settings:
    return Settings(
        _env_file=None,
        RUN_MODE=RunMode.MOCK,
        SOFTWARE_COMMIT="test-commit",
    )


def test_mock_pipeline_returns_valid_result(mock_settings: Settings):
    result = run_pipeline(
        analysis_id="test-001",
        project_id="proj-001",
        source_file_name="test.pdf",
        settings=mock_settings,
    )
    assert result.analysis_id == "test-001"
    assert result.project_id == "proj-001"
    assert result.status.value == "review_required"
    assert len(result.pages) >= 1
    assert len(result.units) >= 1


def test_mock_pipeline_includes_compliance_results(mock_settings: Settings):
    result = run_pipeline(
        analysis_id="test-002",
        project_id="proj-001",
        source_file_name="test.pdf",
        settings=mock_settings,
    )
    assert len(result.compliance_results) >= 1
    cr = result.compliance_results[0]
    assert cr.rule_code == "private_open_space_area"
    assert cr.result.value in {"pass", "fail", "uncertain", "not_applicable", "not_implemented"}


def test_real_mode_not_implemented():
    settings = Settings(_env_file=None, RUN_MODE=RunMode.REAL)
    with pytest.raises(NotImplementedError):
        run_pipeline(
            analysis_id="test-003",
            project_id="proj-001",
            source_file_name="test.pdf",
            settings=settings,
        )
