import type { PlanEntityType } from "@highlife/shared-types";
import { ENTITY_LAYER, newEntityId, type OverlayEntity, type OverlayGeometry } from "./types";

export type LayoutRegionKind = Extract<
  PlanEntityType,
  "title_block" | "main_floorplan" | "legend" | "drawing_border" | "revision_block"
>;

export const LAYOUT_REGION_TYPES: {
  type: LayoutRegionKind;
  label: string;
  hint: string;
}[] = [
  {
    type: "title_block",
    label: "Title block",
    hint: "Scale (1:100 @ A1), level, sheet title",
  },
  {
    type: "main_floorplan",
    label: "Drawing area",
    hint: "Main floor plan content",
  },
  {
    type: "legend",
    label: "Legend block",
    hint: "Symbol legend",
  },
  {
    type: "drawing_border",
    label: "Drawing border",
    hint: "Sheet border frame",
  },
  {
    type: "revision_block",
    label: "Revision block",
    hint: "Revision / issue table",
  },
];

const LAYOUT_TYPE_SET = new Set<PlanEntityType>(LAYOUT_REGION_TYPES.map((t) => t.type));

const LAYOUT_LABEL_OR_TYPE_SET = new Set<string>([
  ...LAYOUT_REGION_TYPES.map((t) => t.type.toLowerCase()),
  ...LAYOUT_REGION_TYPES.map((t) => t.label.toLowerCase()),
  "drawing_area",
  "drawing area",
  "main_floorplan",
  "main floorplan",
  "title_block",
  "title block",
  "legend",
  "legend block",
  "drawing_border",
  "drawing border",
  "revision_block",
  "revision block",
]);

export function isLayoutRegionType(type: PlanEntityType): boolean {
  return LAYOUT_TYPE_SET.has(type);
}

export function isLayoutEntity(entity: {
  type?: string;
  label?: string;
  attributes?: Record<string, unknown>;
}): boolean {
  if (entity.type && isLayoutRegionType(entity.type as PlanEntityType)) return true;
  if (entity.attributes?.layoutRegion) return true;
  if (entity.label) {
    const norm = entity.label.trim().toLowerCase().replace(/[_-]+/g, " ");
    if (
      LAYOUT_LABEL_OR_TYPE_SET.has(norm) ||
      LAYOUT_LABEL_OR_TYPE_SET.has(entity.label.trim().toLowerCase())
    ) {
      return true;
    }
  }
  return false;
}

export function layoutRegionLabel(type: PlanEntityType): string {
  return LAYOUT_REGION_TYPES.find((t) => t.type === type)?.label ?? type;
}

export function makeLayoutRegionEntity(
  type: LayoutRegionKind,
  geometry: OverlayGeometry,
  now = new Date().toISOString(),
): OverlayEntity {
  const meta = LAYOUT_REGION_TYPES.find((t) => t.type === type);
  return {
    id: newEntityId(),
    type,
    layer: ENTITY_LAYER[type],
    geometry,
    label: meta?.label ?? type,
    confidence: 1,
    status: "user_edited",
    source: "manual",
    attributes: { layoutRegion: true, layoutKind: type },
    createdAt: now,
    updatedAt: now,
  };
}
