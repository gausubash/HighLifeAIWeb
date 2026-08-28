"""Build FloorPlanSceneGraph-compatible dicts from detect regions + scale."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.yolo.predict import DetectResult, DetectedRegion


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _poly_area_px(polygon: list[tuple[float, float]]) -> float:
    if len(polygon) < 3:
        return 0.0
    area = 0.0
    n = len(polygon)
    for i in range(n):
        x1, y1 = polygon[i]
        x2, y2 = polygon[(i + 1) % n]
        area += x1 * y2 - x2 * y1
    return abs(area) * 0.5


def _poly_perimeter_px(polygon: list[tuple[float, float]]) -> float:
    if len(polygon) < 2:
        return 0.0
    total = 0.0
    n = len(polygon)
    for i in range(n):
        x1, y1 = polygon[i]
        x2, y2 = polygon[(i + 1) % n]
        total += ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
    return total


def region_to_entity(
    region: DetectedRegion,
    *,
    model_id: str,
    model_version: str,
    page_id: str,
    now: str,
    status: str = "predicted",
) -> dict[str, Any]:
    x, y, w, h = region.bbox
    trust = status in {"user_confirmed", "user_edited"}
    return {
        "id": region.id,
        "type": region.type,
        "bboxPx": {"x": x, "y": y, "width": w, "height": h},
        "polygonPx": [{"x": px, "y": py} for px, py in region.polygon],
        "attributes": {
            **dict(region.attributes or {}),
            "label": region.label,
            "reviewTrust": "confirmed" if trust else "predicted",
        },
        "confidence": float(region.confidence),
        "status": status,
        "evidence": [
            {
                "modelId": model_id,
                "modelVersion": model_version,
                "sourceArtifactId": page_id,
                "confidence": float(region.confidence),
                "inferredAt": now,
            }
        ],
        "createdAt": now,
        "updatedAt": now,
    }


def build_scene_graph(
    result: DetectResult,
    *,
    project_id: str,
    plan_document_id: str = "",
    page_id: str = "page",
    analysis_run_id: str | None = None,
    mm_per_pixel: float | None = None,
    calibration_verified: bool = False,
    sheet_meta: dict[str, Any] | None = None,
    entity_statuses: dict[str, str] | None = None,
) -> dict[str, Any]:
    """
    Convert detect output into a FloorPlanSceneGraph-shaped dict.

    When mm_per_pixel is set, room/wall measurements are attached in metres.
    """
    now = _utcnow()
    run_id = analysis_run_id or str(uuid4())
    statuses = entity_statuses or {}
    entities = [
        region_to_entity(
            region,
            model_id=result.model_id,
            model_version=result.model_version,
            page_id=page_id,
            now=now,
            status=statuses.get(region.id, "predicted"),
        )
        for region in result.regions
        if statuses.get(region.id) != "rejected"
    ]

    calibration = None
    if mm_per_pixel and mm_per_pixel > 0:
        calibration = {
            "id": str(uuid4()),
            "method": "manual_two_point" if calibration_verified else "unknown",
            "mmPerPixel": float(mm_per_pixel),
            "confidence": 0.95 if calibration_verified else 0.5,
            "sourceText": None,
            "sourceGeometryPx": None,
            "verifiedByUser": bool(calibration_verified),
            "active": True,
            "createdAt": now,
        }

    measurements: list[dict[str, Any]] = []
    if calibration:
        m_per_px = float(mm_per_pixel) / 1000.0
        cal_id = calibration["id"]
        for entity in entities:
            etype = str(entity.get("type") or "")
            poly = [
                (float(p["x"]), float(p["y"]))
                for p in (entity.get("polygonPx") or [])
                if isinstance(p, dict)
            ]
            if etype == "room" and len(poly) >= 3:
                area_px = _poly_area_px(poly)
                measurements.append(
                    {
                        "id": str(uuid4()),
                        "kind": "room_area",
                        "sourceGeometryIds": [entity["id"]],
                        "calibrationId": cal_id,
                        "valuePx": area_px,
                        "valueM2": area_px * (m_per_px**2),
                        "unit": "m2",
                        "precision": 2,
                        "confidence": float(entity.get("confidence") or 0.5),
                        "estimated": False,
                    }
                )
            if etype == "wall" and len(poly) >= 2:
                length_px = _poly_perimeter_px(poly) / 2.0  # rough centerline proxy
                measurements.append(
                    {
                        "id": str(uuid4()),
                        "kind": "distance",
                        "sourceGeometryIds": [entity["id"]],
                        "calibrationId": cal_id,
                        "valuePx": length_px,
                        "valueM": length_px * m_per_px,
                        "unit": "m",
                        "precision": 2,
                        "confidence": float(entity.get("confidence") or 0.5),
                        "estimated": True,
                        "formula": "bbox_perimeter/2",
                    }
                )

    meta = dict(sheet_meta or {})
    from app.pipeline.geometry import derive_relationships

    relationships = derive_relationships(entities)
    graph = {
        "schemaVersion": "1.0.0",
        "id": str(uuid4()),
        "projectId": project_id,
        "planDocumentId": plan_document_id or project_id,
        "pageId": page_id,
        "analysisRunId": run_id,
        "coordinateSystems": ["original_image_px", "working_image_px", "world_mm"],
        "workingToOriginal": {
            "scaleX": 1.0,
            "scaleY": 1.0,
            "translateX": 0.0,
            "translateY": 0.0,
        },
        "calibration": calibration,
        "entities": entities,
        "relationships": relationships,
        "measurements": measurements,
        "createdAt": now,
        "updatedAt": now,
        "meta": {
            "widthPx": result.width_px,
            "heightPx": result.height_px,
            "modelId": result.model_id,
            "modelVersion": result.model_version,
            "warning": result.warning,
            "device": result.device,
            **meta,
        },
    }
    return graph
