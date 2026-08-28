import type { PlanEntityType } from "@highlife/shared-types";
import { LAYOUT_LABELME_CLASSES, layoutKindForLabel } from "./layoutLabelClasses";
import { makeLayoutRegionEntity } from "./layoutRegionClasses";
import { ENTITY_LAYER, newEntityId, type OverlayEntity, type OverlayGeometry } from "./types";

/** Keep in sync with services/inference/app/yolo/classes.py CLASS_NAMES. */
export const LABELME_CLASSES = [
  "Unit",
  "Open Living",
  "Bedroom",
  "Bathroom",
  "Ensuite",
  "Laundry",
  "Closet",
  "Store",
  "Balcony",
  "Lobby",
  "Communal Space",
  "Wall",
  "External Wall",
  "Single Door",
  "Sliding Door",
  "Main Door",
  "Window",
  "Stair",
  "Lift",
] as const;

export type LabelMeClass = (typeof LABELME_CLASSES)[number];

export const DEFAULT_LABEL_CLASS: LabelMeClass = "Bedroom";

const LABEL_SET = new Set<string>(LABELME_CLASSES);

export const LABEL_ALIASES: Record<string, string> = {
  Living: "Open Living",
  Toilet: "Bathroom",
  "Double Door": "Single Door",
  "Home Office": "Bedroom",
};

const LABEL_TO_ENTITY_TYPE: Record<string, PlanEntityType> = {
  Unit: "unit_boundary",
  "Open Living": "room",
  Bedroom: "room",
  Bathroom: "room",
  Ensuite: "room",
  Laundry: "room",
  Closet: "room",
  Store: "room",
  Balcony: "room",
  Lobby: "room",
  "Communal Space": "room",
  Wall: "wall",
  "External Wall": "wall",
  "Single Door": "door",
  "Sliding Door": "door",
  "Main Door": "door",
  Window: "window",
  Stair: "stair",
  Lift: "other",
};

const ROOM_TYPE_ATTR: Record<string, string> = {
  Unit: "unit",
  "Open Living": "living",
  Bedroom: "bedroom",
  Bathroom: "bathroom",
  Ensuite: "bathroom",
  Laundry: "laundry",
  Closet: "closet",
  Store: "store",
  Balcony: "balcony",
  Lobby: "lobby",
  "Communal Space": "common_corridor",
};

function norm(label: string): string {
  return label.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

const CLASS_BY_NORM = new Map(LABELME_CLASSES.map((name) => [norm(name), name]));

export function isKnownAnnotateClass(value: string): boolean {
  return isLabelMeClass(value) || LAYOUT_LABELME_CLASSES.includes(value);
}

/** Classes in a dataset that are not built-in room/layout labels. */
export function extraClassesFromDataset(classNames: string[]): string[] {
  const known = new Set<string>([...LABELME_CLASSES, ...LAYOUT_LABELME_CLASSES]);
  const extras: string[] = [];
  const seen = new Set<string>();
  for (const raw of classNames) {
    const name = (raw || "").trim();
    if (!name || known.has(name) || seen.has(name)) continue;
    seen.add(name);
    extras.push(name);
  }
  return extras;
}

/** Built-in LabelMe classes plus dataset-specific extras (deduped, order preserved). */
export function mergeAnnotateClasses(classNames: string[]): string[] {
  return [...LABELME_CLASSES, ...extraClassesFromDataset(classNames)];
}

export function isLabelMeClass(value: string): value is LabelMeClass {
  return LABEL_SET.has(value);
}

export function canonicalLabel(raw: string): string | null {
  const name = (raw || "").trim();
  if (!name) return null;
  const aliased = LABEL_ALIASES[name] ?? name;
  if (LABEL_SET.has(aliased)) return aliased;
  return CLASS_BY_NORM.get(norm(aliased)) ?? null;
}

export function displayLabel(raw: string): string {
  const canonical = canonicalLabel(raw);
  if (canonical) return canonical;
  const trimmed = (raw || "").trim();
  return trimmed || "Region";
}

export function entityTypeForLabel(label: string): PlanEntityType {
  const layoutKind = layoutKindForLabel(label);
  if (layoutKind) return layoutKind;
  const canonical = canonicalLabel(label) ?? displayLabel(label);
  return LABEL_TO_ENTITY_TYPE[canonical] ?? "other";
}

export function roomTypeFor(label: string): string {
  const canonical = canonicalLabel(label) ?? displayLabel(label);
  return ROOM_TYPE_ATTR[canonical] ?? norm(canonical).replace(/ /g, "_");
}

export function makeLabeledEntity(
  label: string,
  geometry: OverlayGeometry,
  source = "manual",
  now = new Date().toISOString(),
): OverlayEntity {
  const layoutKind = layoutKindForLabel(label);
  if (layoutKind) {
    const entity = makeLayoutRegionEntity(layoutKind, geometry, now);
    entity.source = source;
    return entity;
  }
  const shown = displayLabel(label);
  const type = entityTypeForLabel(shown);
  return {
    id: newEntityId(),
    type,
    layer: ENTITY_LAYER[type],
    geometry,
    label: shown,
    confidence: 1,
    status: "user_edited",
    source,
    attributes: { roomType: roomTypeFor(shown) },
    createdAt: now,
    updatedAt: now,
  };
}
