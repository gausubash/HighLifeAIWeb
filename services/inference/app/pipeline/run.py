"""Pipeline entry point — mock and real modes."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.config import RunMode, Settings, get_settings
from app.pipeline.policy_engine import evaluate_policy, load_policy_pack, resolve_policy_pack_path
from app.pipeline.scene_graph import build_scene_graph
from app.pipeline.sheet_context import extract_sheet_context
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
from app.yolo.predict import DetectResult, _load_rgb

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


def _spaces_from_graph(graph: dict[str, Any]) -> list[SpaceSchema]:
    from app.pipeline.geometry import is_common_label

    spaces: list[SpaceSchema] = []
    area_by_id = {
        (m.get("sourceGeometryIds") or [None])[0]: m.get("valueM2")
        for m in graph.get("measurements") or []
        if m.get("kind") == "room_area"
    }
    contains = [
        r
        for r in (graph.get("relationships") or [])
        if r.get("kind") == "unit_contains_room"
    ]
    room_to_unit = {str(r["toId"]): str(r["fromId"]) for r in contains}

    for entity in graph.get("entities") or []:
        if str(entity.get("type")) != "room":
            continue
        poly = [[float(p["x"]), float(p["y"])] for p in (entity.get("polygonPx") or [])]
        if len(poly) < 3:
            continue
        label = str((entity.get("attributes") or {}).get("label") or "Room")
        eid = str(entity["id"])
        common = is_common_label(label)
        spaces.append(
            SpaceSchema(
                id=eid,
                external_id=label,
                space_type=label.lower().replace(" ", "_"),
                unit_id=None if common else room_to_unit.get(eid),
                geometry=poly,
                area_m2=float(area_by_id[eid]) if area_by_id.get(eid) is not None else None,
                confidence=float(entity.get("confidence") or 0.5),
                review_required=str(entity.get("status")) == "predicted",
                is_common=common,
            )
        )
    return spaces


def _openings_from_graph(graph: dict[str, Any]) -> list[OpeningSchema]:
    openings: list[OpeningSchema] = []
    access = {
        str(r.get("toId")): str(r.get("fromId"))
        for r in (graph.get("relationships") or [])
        if r.get("kind") in {"room_door_access", "room_window_access"}
    }
    for entity in graph.get("entities") or []:
        et = str(entity.get("type") or "")
        if et not in {"door", "window"}:
            continue
        poly = [[float(p["x"]), float(p["y"])] for p in (entity.get("polygonPx") or [])]
        if len(poly) < 3:
            continue
        eid = str(entity["id"])
        openings.append(
            OpeningSchema(
                id=eid,
                external_id=str((entity.get("attributes") or {}).get("label") or et),
                opening_type=et,
                geometry=poly,
                from_space_id=access.get(eid),
                confidence=float(entity.get("confidence") or 0.5),
            )
        )
    return openings


def analyze_from_detect(
    result: DetectResult,
    *,
    analysis_id: str,
    project_id: str,
    source_file_name: str = "page.png",
    image_bytes: bytes | None = None,
    mm_per_pixel: float | None = None,
    calibration_verified: bool = False,
    entity_statuses: dict[str, str] | None = None,
    policy_version: str | None = None,
    settings: Settings | None = None,
) -> tuple[AnalysisResultSchema, dict[str, Any]]:
    """Build scene graph + run design-policy pack; return analysis result and graph."""
    settings = settings or get_settings()
    sheet_meta: dict[str, Any] = {}
    if image_bytes:
        try:
            rgb = _load_rgb(image_bytes)
            sheet_meta = extract_sheet_context(rgb, settings=settings)
        except Exception as exc:
            sheet_meta = {"warnings": [f"sheet_context_failed: {exc}"], "provider": "none"}

    pack_key = (policy_version or settings.policy_pack_path or settings.policy_version or "").strip() or None
    pack_path = resolve_policy_pack_path(pack_key)
    try:
        pack = load_policy_pack(pack_path)
        policy_version_out = str(pack.get("version") or settings.policy_version)
    except Exception:
        pack = None
        policy_version_out = settings.policy_version

    graph = build_scene_graph(
        result,
        project_id=project_id,
        analysis_run_id=analysis_id,
        page_id="page-1",
        mm_per_pixel=mm_per_pixel,
        calibration_verified=calibration_verified,
        sheet_meta=sheet_meta,
        entity_statuses=entity_statuses,
    )

    if pack is not None:
        compliance = evaluate_policy(
            graph,
            analysis_id=analysis_id,
            pack=pack,
        )
    else:
        compliance = []

    spaces = _spaces_from_graph(graph)
    openings = _openings_from_graph(graph)
    from app.pipeline.geometry import units_from_entities
    from app.schemas import UnitSchema as _UnitSchema

    area_by_id = {
        (m.get("sourceGeometryIds") or [None])[0]: m.get("valueM2")
        for m in graph.get("measurements") or []
        if m.get("kind") == "room_area"
    }
    unit_dicts = units_from_entities(
        list(graph.get("entities") or []),
        list(graph.get("relationships") or []),
        width_px=result.width_px,
        height_px=result.height_px,
        area_by_room={str(k): (float(v) if v is not None else None) for k, v in area_by_id.items() if k},
    )
    units = [_UnitSchema.model_validate(u) for u in unit_dicts]
    unit = units[0] if units else UnitSchema(
        id=str(uuid4()),
        external_id="unit-1",
        geometry=[[0, 0], [result.width_px, 0], [result.width_px, result.height_px], [0, result.height_px]],
        area_m2=None,
        space_ids=[],
        entrance_ids=[],
        confidence=0.5,
        review_required=True,
    )
    warnings: list[ReviewWarningSchema] = []
    if result.warning:
        warnings.append(
            ReviewWarningSchema(code="DETECT_WARNING", message=result.warning, severity="warning")
        )
    for w in sheet_meta.get("warnings") or []:
        warnings.append(ReviewWarningSchema(code="SHEET_CONTEXT", message=str(w), severity="info"))
    if not mm_per_pixel:
        warnings.append(
            ReviewWarningSchema(
                code="SCALE_MISSING",
                message="No scale calibration — metric policy rules marked uncertain.",
                severity="warning",
            )
        )

    page = PlanPageSchema(
        id="page-1",
        page_number=1,
        image_path=source_file_name,
        width_px=result.width_px,
        height_px=result.height_px,
        is_floor_plan=True,
        scale_m_per_pixel=(mm_per_pixel / 1000.0) if mm_per_pixel else None,
        scale_source=(
            "manual"
            if calibration_verified
            else ("paddleocr" if sheet_meta.get("provider") == "paddleocr" and sheet_meta.get("scaleText") else ("vlm" if sheet_meta.get("scaleText") else None))
        ),
        scale_confidence=0.9 if calibration_verified else (float(sheet_meta.get("confidence") or 0) if sheet_meta.get("scaleText") else None),
        source_file_name=source_file_name,
        level_name=str(sheet_meta.get("levelName") or "Floor 1"),
        level_index=0,
        floor_id="floor-page-1",
    )

    bedroom_n = sum(1 for s in spaces if "bed" in s.space_type)
    bath_n = sum(1 for s in spaces if "bath" in s.space_type)
    summaries = []
    for u in units:
        u_spaces = [s for s in spaces if s.id in set(u.space_ids) and not s.is_common]
        summaries.append(
            UnitSummarySchema(
                unit_id=u.id,
                area_m2=float(u.area_m2 or 0),
                room_count=len(u_spaces),
                bedroom_count=sum(1 for s in u_spaces if "bed" in s.space_type),
                bathroom_count=sum(1 for s in u_spaces if "bath" in s.space_type),
                private_open_space_area_m2=sum(
                    s.area_m2 or 0 for s in u_spaces if "balcon" in s.space_type or "terrace" in s.space_type
                ),
                confidence=float(u.confidence or 0.7),
                review_status="review_required" if u.review_required else "ok",
            )
        )
    if not summaries:
        summaries = [
            UnitSummarySchema(
                unit_id=unit.id,
                area_m2=float(unit.area_m2 or 0),
                room_count=len([s for s in spaces if not s.is_common]),
                bedroom_count=bedroom_n,
                bathroom_count=bath_n,
                private_open_space_area_m2=sum(
                    s.area_m2 or 0 for s in spaces if "balcon" in s.space_type or "terrace" in s.space_type
                ),
                confidence=0.7,
                review_status="review_required" if unit.review_required else "ok",
            )
        ]

    from app.pipeline.hierarchy import build_building_hierarchy
    from app.schemas import BuildingHierarchySchema

    hierarchy_raw = build_building_hierarchy(
        analysis_id=analysis_id,
        project_id=project_id,
        source_file_name=source_file_name,
        pages=[page],
        spaces=spaces,
        units=units or [unit],
        openings=openings,
        relationships=list(graph.get("relationships") or []),
    )
    hierarchy = BuildingHierarchySchema.model_validate(hierarchy_raw)

    status = AnalysisStatus.REVIEW_REQUIRED if unit.review_required or not mm_per_pixel else AnalysisStatus.COMPLETED
    analysis = AnalysisResultSchema(
        analysis_id=analysis_id,
        project_id=project_id,
        source_file_name=source_file_name,
        status=status,
        current_stage=status.value,
        software_commit=settings.software_commit,
        model_versions={
            "detect": f"{result.model_id}@{result.model_version}",
            "sheet_context": str(sheet_meta.get("provider") or "none"),
            "policy": policy_version_out,
        },
        policy_version=policy_version_out,
        dataset_version=settings.dataset_version,
        created_at=datetime.now(timezone.utc),
        pages=[page],
        spaces=spaces,
        units=units or [unit],
        openings=openings,
        hierarchy=hierarchy,
        compliance_results=compliance,
        unit_summaries=summaries,
        review_warnings=warnings,
    )
    return analysis, graph


def run_pipeline(
    *,
    analysis_id: str,
    project_id: str,
    source_file_name: str,
    settings: Settings | None = None,
    detect_result: DetectResult | None = None,
    image_bytes: bytes | None = None,
    mm_per_pixel: float | None = None,
    calibration_verified: bool = False,
    entity_statuses: dict[str, str] | None = None,
) -> AnalysisResultSchema:
    """
    Execute the analysis pipeline.

    Mock mode returns deterministic fixture output.
    Real mode evaluates design-policy rules on a detect-derived scene graph.
    """
    settings = settings or get_settings()

    if settings.run_mode == RunMode.MOCK and detect_result is None:
        return _build_mock_result(
            analysis_id=analysis_id,
            project_id=project_id,
            source_file_name=source_file_name,
            settings=settings,
        )

    if detect_result is None:
        # Real mode without detections → empty graph policy run (uncertain walls).
        detect_result = DetectResult(
            model_id="none",
            model_version="0",
            width_px=1,
            height_px=1,
            regions=[],
            warning="No detections supplied to analyze.",
        )

    analysis, _graph = analyze_from_detect(
        detect_result,
        analysis_id=analysis_id,
        project_id=project_id,
        source_file_name=source_file_name,
        image_bytes=image_bytes,
        mm_per_pixel=mm_per_pixel,
        calibration_verified=calibration_verified,
        entity_statuses=entity_statuses,
        settings=settings,
    )
    return analysis


__all__ = [
    "run_pipeline",
    "analyze_from_detect",
    "AnalysisResultSchema",
    "SpaceSchema",
    "UnitSchema",
    "OpeningSchema",
    "ComplianceResultSchema",
    "ComplianceResultCategory",
]
