import type { PlanEntityType } from "@highlife/shared-types";
import type { LayoutRegionKind } from "./layoutRegionClasses";
import { LAYOUT_REGION_TYPES } from "./layoutRegionClasses";

/** Sheet layout regions — draw as rectangles in Model Studio Annotate. */
export const LAYOUT_LABELME_CLASSES = LAYOUT_REGION_TYPES.map((item) => item.label) as readonly string[];

export type LayoutLabelMeClass = (typeof LAYOUT_LABELME_CLASSES)[number];

const LAYOUT_LABEL_SET = new Set<string>(LAYOUT_LABELME_CLASSES);

const LABEL_TO_LAYOUT_KIND: Record<string, LayoutRegionKind> = {
  "Title block": "title_block",
  "Drawing area": "main_floorplan",
  "Legend block": "legend",
  "Drawing border": "drawing_border",
  "Revision block": "revision_block",
};

function norm(label: string): string {
  return label.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

const KIND_BY_NORM = new Map(
  LAYOUT_REGION_TYPES.map((item) => [norm(item.label), item.type]),
);

export function isLayoutLabelMeClass(value: string): boolean {
  return LAYOUT_LABEL_SET.has(value);
}

export function layoutKindForLabel(label: string): LayoutRegionKind | null {
  const direct = LABEL_TO_LAYOUT_KIND[label];
  if (direct) return direct;
  return KIND_BY_NORM.get(norm(label)) ?? null;
}

export function layoutEntityTypeForLabel(label: string): PlanEntityType | null {
  return layoutKindForLabel(label);
}
