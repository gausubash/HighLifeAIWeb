from __future__ import annotations

from app.schemas.scene_graph import (
    SCENE_GRAPH_SCHEMA_VERSION,
    Calibration,
    CoordinateTransform,
    EntityRelationship,
    Evidence,
    FloorPlanSceneGraph,
    Measurement,
    PlanEntity,
    Point,
    BoundingBox,
    new_id,
    utcnow,
)


def iso(dt) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def mock_apartment_scene_graph(
    *,
    project_id: str,
    plan_document_id: str,
    page_id: str,
    analysis_run_id: str,
) -> FloorPlanSceneGraph:
    """Two rooms, one door, one wall, one calibration — schema-valid mock."""
    now = iso(utcnow())
    cal_id = new_id()
    wall_id = new_id()
    door_id = new_id()
    living_id = new_id()
    bed_id = new_id()
    crop_id = new_id()
    art_id = new_id()

    evidence = [
        Evidence(
            modelId="mock_layout",
            modelVersion="0.0.1",
            sourceArtifactId=art_id,
            confidence=0.42,
            inferredAt=now,
        )
    ]

    living_poly = [
        Point(x=80, y=80),
        Point(x=520, y=80),
        Point(x=520, y=420),
        Point(x=80, y=420),
    ]
    bed_poly = [
        Point(x=520, y=80),
        Point(x=860, y=80),
        Point(x=860, y=420),
        Point(x=520, y=420),
    ]

    graph = FloorPlanSceneGraph(
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
        calibration=Calibration(
            id=cal_id,
            method="manual_two_point",
            mmPerPixel=5.0,
            confidence=0.95,
            sourceText="3000 mm wall dimension",
            sourceGeometryPx=[Point(x=80, y=80), Point(x=680, y=80)],
            verifiedByUser=True,
            active=True,
            createdAt=now,
        ),
        entities=[
            PlanEntity(
                id=crop_id,
                type="main_floorplan",
                bboxPx=BoundingBox(x=40, y=40, width=860, height=420),
                polygonPx=[
                    Point(x=40, y=40),
                    Point(x=900, y=40),
                    Point(x=900, y=460),
                    Point(x=40, y=460),
                ],
                attributes={"label": "Main plan"},
                confidence=1.0,
                status="user_confirmed",
                evidence=[],
                createdAt=now,
                updatedAt=now,
            ),
            PlanEntity(
                id=wall_id,
                type="wall",
                polylinePx=[Point(x=520, y=80), Point(x=520, y=420)],
                attributes={"orientation": "vertical", "thicknessPx": 8},
                confidence=0.4,
                status="predicted",
                evidence=evidence,
                createdAt=now,
                updatedAt=now,
            ),
            PlanEntity(
                id=door_id,
                type="door",
                bboxPx=BoundingBox(x=500, y=220, width=40, height=24),
                polylinePx=[Point(x=520, y=220), Point(x=520, y=244)],
                attributes={"openingKind": "hinged_door", "spanPx": 24},
                confidence=0.35,
                status="predicted",
                evidence=evidence,
                createdAt=now,
                updatedAt=now,
            ),
            PlanEntity(
                id=living_id,
                type="room",
                polygonPx=living_poly,
                bboxPx=BoundingBox(x=80, y=80, width=440, height=340),
                attributes={"label": "Living", "roomType": "living"},
                confidence=1.0,
                status="user_edited",
                evidence=[],
                createdAt=now,
                updatedAt=now,
            ),
            PlanEntity(
                id=bed_id,
                type="room",
                polygonPx=bed_poly,
                bboxPx=BoundingBox(x=520, y=80, width=340, height=340),
                attributes={"label": "Bedroom", "roomType": "bedroom"},
                confidence=1.0,
                status="user_edited",
                evidence=[],
                createdAt=now,
                updatedAt=now,
            ),
        ],
        relationships=[
            EntityRelationship(
                id=new_id(),
                type="room_adjacency",
                fromEntityId=living_id,
                toEntityId=bed_id,
                confidence=0.9,
                attributes={"via": "shared_wall", "wallId": wall_id},
            ),
            EntityRelationship(
                id=new_id(),
                type="door_to_wall",
                fromEntityId=door_id,
                toEntityId=wall_id,
                confidence=0.8,
                attributes={},
            ),
            EntityRelationship(
                id=new_id(),
                type="room_door_access",
                fromEntityId=living_id,
                toEntityId=bed_id,
                confidence=0.7,
                attributes={"doorId": door_id},
            ),
        ],
        measurements=[
            Measurement(
                id=new_id(),
                kind="room_area",
                sourceGeometryIds=[living_id],
                calibrationId=cal_id,
                valuePx=440 * 340,
                valueM2=(440 * 5.0 / 1000) * (340 * 5.0 / 1000),
                unit="m2",
                precision=2,
                confidence=0.9,
                formula="shoelace(polygon) * (mm_per_pixel/1000)^2",
                estimated=False,
            ),
            Measurement(
                id=new_id(),
                kind="room_perimeter",
                sourceGeometryIds=[living_id],
                calibrationId=cal_id,
                valuePx=2 * (440 + 340),
                valueMm=2 * (440 + 340) * 5.0,
                valueM=2 * (440 + 340) * 5.0 / 1000,
                unit="m",
                precision=2,
                confidence=0.9,
                estimated=False,
            ),
            Measurement(
                id=new_id(),
                kind="opening_width",
                sourceGeometryIds=[door_id],
                calibrationId=cal_id,
                valuePx=24,
                valueMm=120,
                unit="mm",
                precision=0,
                confidence=0.35,
                estimated=True,
            ),
            Measurement(
                id=new_id(),
                kind="wall_thickness",
                sourceGeometryIds=[wall_id],
                calibrationId=cal_id,
                valuePx=8,
                valueMm=40,
                unit="mm",
                precision=0,
                confidence=0.4,
                estimated=True,
            ),
            Measurement(
                id=new_id(),
                kind="min_room_width",
                sourceGeometryIds=[bed_id],
                calibrationId=cal_id,
                valueMm=340 * 5.0,
                unit="mm",
                precision=0,
                confidence=0.9,
                estimated=False,
            ),
        ],
        createdAt=now,
        updatedAt=now,
    )
    return graph
