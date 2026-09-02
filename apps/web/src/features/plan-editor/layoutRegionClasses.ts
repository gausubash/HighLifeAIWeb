import type { PlanEntityType } from "@highlife/shared-types";
import { ENTITY_LAYER, newEntityId, type OverlayEntity, type OverlayGeometry } from "./types";

export type LayoutRegionKind = Extract<
  PlanEntityType,
  "title_block" | "main_floorplan" | "legend" | "drawing_border" | "revision_block" | "notes"
>;

/** Default sheet zones: main drawing (core) + title block (information anchor). */
export const DEFAULT_LAYOUT_ZONE_TYPES: LayoutRegionKind[] = [
  "main_floorplan",
  "title_block",
];

export const LAYOUT_REGION_TYPES: {
  type: LayoutRegionKind;
  label: string;
  hint: string;
}[] = [
  {
    type: "main_floorplan",
    label: "Main drawing",
    hint: "Floor plan, local labels, and dimension grid — typically 70–80% of the sheet",
  },
  {
    type: "title_block",
    label: "Title block",
    hint: "Bottom-right project info, sheet number, scale, seals",
  },
  {
    type: "legend",
    label: "Legend & key",
    hint: "Symbol legend, material key, and key plan above the title block",
  },
  {
    type: "revision_block",
    label: "Production",
    hint: "Revision history and issue status next to the title block",
  },
  {
    type: "drawing_border",
    label: "Border",
    hint: "Sheet margin, binding edge, and grid referencing",
  },
];

/** Typed names → built-in kinds. Everything else is a custom zone. */
const ZONE_NAME_ALIASES: Record<string, LayoutRegionKind> = {
  "main drawing": "main_floorplan",
  "main drawing zone": "main_floorplan",
  "drawing area": "main_floorplan",
  "drawing zone": "main_floorplan",
  "floor plan": "main_floorplan",
  "floor plan image": "main_floorplan",
  "title block": "title_block",
  title: "title_block",
  information: "title_block",
  "data zone": "title_block",
  legend: "legend",
  "legend block": "legend",
  "legend & key": "legend",
  "legend and key": "legend",
  "symbol legend": "legend",
  "material key": "legend",
  revision: "revision_block",
  "revision block": "revision_block",
  "revision history": "revision_block",
  production: "revision_block",
  "production block": "revision_block",
  "issue status": "revision_block",
  border: "drawing_border",
  "drawing border": "drawing_border",
  margin: "drawing_border",
  "utility": "drawing_border",
};

const LAYOUT_TYPE_SET = new Set<PlanEntityType>([
  ...LAYOUT_REGION_TYPES.map((t) => t.type),
  "notes",
]);

const LAYOUT_LABEL_OR_TYPE_SET = new Set<string>([
  ...LAYOUT_REGION_TYPES.map((t) => t.type.toLowerCase()),
  ...LAYOUT_REGION_TYPES.map((t) => t.label.toLowerCase()),
  "drawing_area",
  "drawing area",
  "main drawing",
  "main_floorplan",
  "main floorplan",
  "title_block",
  "title block",
  "legend",
  "legend block",
  "legend & key",
  "drawing_border",
  "drawing border",
  "border",
  "revision_block",
  "revision block",
  "production",
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

export function layoutRegionLabel(type: PlanEntityType, fallback?: string): string {
  return fallback?.trim() || LAYOUT_REGION_TYPES.find((t) => t.type === type)?.label || type;
}

export function normalizeZoneName(name: string): string {
  return name.trim().toLowerCase().replace(/[_-]+/g, " ");
}

export function layoutKindForZoneName(name: string): LayoutRegionKind {
  const n = normalizeZoneName(name);
  if (!n) return "notes";
  const aliased = ZONE_NAME_ALIASES[n];
  if (aliased) return aliased;
  const match = LAYOUT_REGION_TYPES.find(
    (t) => normalizeZoneName(t.label) === n || t.type.replace(/_/g, " ") === n,
  );
  return match?.type ?? "notes";
}

export function makeLayoutRegionEntity(
  type: LayoutRegionKind,
  geometry: OverlayGeometry,
  now = new Date().toISOString(),
  label?: string,
): OverlayEntity {
  const meta = LAYOUT_REGION_TYPES.find((t) => t.type === type);
  const resolved = label?.trim() || meta?.label || type;
  return {
    id: newEntityId(),
    type,
    layer: ENTITY_LAYER[type],
    geometry,
    label: resolved,
    confidence: 1,
    status: "user_edited",
    source: "manual",
    attributes: { layoutRegion: true, layoutKind: type, zoneName: resolved },
    createdAt: now,
    updatedAt: now,
  };
}
