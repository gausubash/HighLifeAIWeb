import type { PlanEntityType } from "@highlife/shared-types";
import type { DetectedRegion } from "@/lib/api/floorPlanClient";
import { ENTITY_LAYER, type OverlayEntity } from "./types";

const ENTITY_TYPES = new Set<PlanEntityType>([
  "wall",
  "door",
  "window",
  "room",
  "unit_boundary",
  "column",
  "stair",
  "fixture",
  "text_label",
  "dimension",
  "title_block",
  "legend",
  "north_arrow",
  "scale_region",
  "notes",
  "other",
  "main_floorplan",
  "drawing_border",
  "revision_block",
]);

function asEntityType(value: string): PlanEntityType {
  return ENTITY_TYPES.has(value as PlanEntityType) ? (value as PlanEntityType) : "room";
}

export function detectedRegionToOverlay(region: DetectedRegion, now = new Date().toISOString()): OverlayEntity {
  const type = asEntityType(region.type);
  return {
    id: region.id,
    type,
    layer: ENTITY_LAYER[type],
    geometry: {
      kind: "polygon",
      points: region.polygonPx.map((p) => ({ x: p.x, y: p.y })),
    },
    label: region.label,
    confidence: region.confidence,
    status: "predicted",
    source: "model",
    attributes: {
      ...region.attributes,
      label: region.label,
      roomType:
        typeof region.attributes.roomType === "string"
          ? region.attributes.roomType
          : region.label.toLowerCase(),
    },
    createdAt: now,
    updatedAt: now,
  };
}
