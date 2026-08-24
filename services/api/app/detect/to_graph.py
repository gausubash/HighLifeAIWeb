from __future__ import annotations

from app.detect.pipeline import DetectResult
from app.schemas.scene_graph import (
    SCENE_GRAPH_SCHEMA_VERSION,
    BoundingBox,
    CoordinateTransform,
    Evidence,
    FloorPlanSceneGraph,
    PlanEntity,
    Point,
    new_id,
    utcnow,
)


def detect_result_to_scene_graph(
    result: DetectResult,
    *,
    project_id: str,
    plan_document_id: str,
    page_id: str,
    analysis_run_id: str,
) -> FloorPlanSceneGraph:
    now = utcnow().isoformat().replace("+00:00", "Z")
    evidence = [
        Evidence(
            modelId=result.model_id,
            modelVersion=result.model_version,
            sourceArtifactId=page_id,
            confidence=1.0,
            inferredAt=now,
        )
    ]
    entities: list[PlanEntity] = []
    for region in result.regions:
        x, y, w, h = region.bbox
        entities.append(
            PlanEntity(
                id=region.id,
                type=region.type,  # type: ignore[arg-type]
                bboxPx=BoundingBox(x=x, y=y, width=w, height=h),
                polygonPx=[Point(x=px, y=py) for px, py in region.polygon],
                attributes=region.attributes,
                confidence=region.confidence,
                status="predicted",
                evidence=evidence,
                createdAt=now,
                updatedAt=now,
            )
        )

    return FloorPlanSceneGraph(
        schemaVersion=SCENE_GRAPH_SCHEMA_VERSION,
        id=new_id(),
        projectId=project_id,
        planDocumentId=plan_document_id,
        pageId=page_id,
        analysisRunId=analysis_run_id,
        coordinateSystems=["original_image_px", "working_image_px", "world_mm"],
        workingToOriginal=CoordinateTransform(
            scaleX=1.0, scaleY=1.0, translateX=0.0, translateY=0.0
        ),
        calibration=None,
        entities=entities,
        relationships=[],
        measurements=[],
        createdAt=now,
        updatedAt=now,
    )
