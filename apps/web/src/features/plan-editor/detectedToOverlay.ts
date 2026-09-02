import type { PlanEntityType } from "@highlife/shared-types";
import type { DetectedRegion } from "@/lib/api/floorPlanClient";
import { headingFromGeometry } from "@/lib/hierarchy/apartmentAspect";
import {
  headingFromCompassKeypoints,
  headingVecFromCompassKeypoints,
  resolveCompassKeypoints,
  serializeCompassKeypoints,
} from "@/lib/hierarchy/compassKeypoints";
import { canonicalLabel, entityTypeForLabel } from "./labelClasses";
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

function openingTypeFor(region: DetectedRegion, type: PlanEntityType): string | undefined {
  if (typeof region.attributes.openingType === "string" && region.attributes.openingType.trim()) {
    return region.attributes.openingType;
  }
  if (type !== "door" && type !== "window") return undefined;
  if (type === "window") return "window";
  return region.label.trim().toLowerCase() === "main door" ? "unit_entrance" : "internal_room_door";
}

export function detectedRegionToOverlay(region: DetectedRegion, now = new Date().toISOString()): OverlayEntity {
  const label = canonicalLabel(region.label) ?? region.label;
  const labeledType = entityTypeForLabel(label);
  const type = labeledType !== "other" ? labeledType : asEntityType(region.type);
  const openingType = openingTypeFor(region, type);
  const headingDeg =
    type === "north_arrow"
      ? headingFromGeometry(region.polygonPx, region.attributes)
      : null;
  const keypoints =
    type === "north_arrow"
      ? resolveCompassKeypoints(region.attributes, region.polygonPx, headingDeg)
      : [];
  const headingVec = headingVecFromCompassKeypoints(keypoints);
  const headingFromKpts = headingFromCompassKeypoints(keypoints);
  return {
    id: region.id,
    type,
    layer: ENTITY_LAYER[type],
    geometry: {
      kind: "polygon",
      points: region.polygonPx.map((p) => ({ x: p.x, y: p.y })),
    },
    label,
    confidence: region.confidence,
    status: "predicted",
    source: "model",
    attributes: {
      ...region.attributes,
      label,
      roomType:
        typeof region.attributes.roomType === "string"
          ? region.attributes.roomType
          : label.toLowerCase(),
      ...(openingType ? { openingType } : {}),
      ...(keypoints.length ? { keypoints: serializeCompassKeypoints(keypoints) } : {}),
      ...(headingVec ? { headingVec } : {}),
      ...(headingFromKpts != null ? { headingDeg: headingFromKpts } : headingDeg != null ? { headingDeg } : {}),
    },
    createdAt: now,
    updatedAt: now,
  };
}
