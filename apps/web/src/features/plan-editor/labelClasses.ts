import type { PlanEntityType } from "@highlife/shared-types";
import { headingFromGeometry } from "@/lib/hierarchy/apartmentAspect";
import { resolveCompassKeypoints, serializeCompassKeypoints } from "@/lib/hierarchy/compassKeypoints";
import { overlayGeometryPoints } from "./geometry";
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
  living: "Open Living",
  LIVING: "Open Living",
  Lounge: "Open Living",
  lounge: "Open Living",
  Family: "Open Living",
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
  "North Arrow": "north_arrow",
  "north arrow": "north_arrow",
  north_arrow: "north_arrow",
  North: "north_arrow",
  north: "north_arrow",
  Compass: "north_arrow",
  compass: "north_arrow",
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
for (const [alias, canonical] of Object.entries(LABEL_ALIASES)) {
  if (!CLASS_BY_NORM.has(norm(alias))) CLASS_BY_NORM.set(norm(alias), canonical);
}

export function isKnownAnnotateClass(value: string): boolean {
  return canonicalLabel(value) != null || LAYOUT_LABELME_CLASSES.some((c) => norm(c) === norm(value));
}

/** Classes in a dataset that are not built-in room/layout labels. */
export function extraClassesFromDataset(classNames: string[]): string[] {
  const extras: string[] = [];
  const seen = new Set<string>();
  for (const raw of classNames) {
    const name = (raw || "").trim();
    if (!name || isKnownAnnotateClass(name) || seen.has(norm(name))) continue;
    seen.add(norm(name));
    extras.push(name);
  }
  return extras;
}

/** Built-in LabelMe classes plus dataset-specific extras (deduped, order preserved). */
export function mergeAnnotateClasses(classNames: string[]): string[] {
  return [...LABELME_CLASSES, ...extraClassesFromDataset(classNames)];
}

export function isLabelMeClass(value: string): value is LabelMeClass {
  const canonical = canonicalLabel(value);
  return canonical != null && LABEL_SET.has(canonical);
}

export function canonicalLabel(raw: string): string | null {
  const name = (raw || "").trim();
  if (!name) return null;
  if (LABEL_SET.has(name)) return name;
  const folded = norm(name);
  const aliased = LABEL_ALIASES[name] ?? LABEL_ALIASES[folded];
  if (aliased && LABEL_SET.has(aliased)) return aliased;
  return CLASS_BY_NORM.get(folded) ?? null;
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
  if (LABEL_TO_ENTITY_TYPE[canonical]) return LABEL_TO_ENTITY_TYPE[canonical];
  const n = norm(canonical);
  if (n === "north" || n === "compass" || n.startsWith("north arrow")) return "north_arrow";
  if (/^unit(\b|\s)/i.test(label.trim())) return "unit_boundary";
  return "other";
}

/** Detected Unit boxes, inferred outlines, or any overlay typed as a unit boundary. */
export function isUnitOutlineEntity(entity: {
  type: string;
  label?: string | null;
  status?: string;
}): boolean {
  if (entity.status === "rejected") return false;
  if (entity.type === "unit_boundary") return true;
  return entityTypeForLabel(entity.label ?? "") === "unit_boundary";
}

export function isWallOverlayEntity(entity: {
  type: string;
  label?: string | null;
  status?: string;
}): boolean {
  if (entity.status === "rejected") return false;
  if (entity.type === "wall") return true;
  const c = canonicalLabel(entity.label ?? "");
  return c === "Wall" || c === "External Wall";
}

export function isRoomOverlayEntity(entity: {
  type: string;
  label?: string | null;
  status?: string;
}): boolean {
  if (entity.status === "rejected") return false;
  if (isUnitOutlineEntity(entity) || isWallOverlayEntity(entity)) return false;
  const type = (entity.type ?? "").trim();
  if (type === "door" || type === "window") return false;
  if (type === "room") return true;
  return entityTypeForLabel(entity.label ?? "") === "room";
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
  const attributes: Record<string, unknown> = { roomType: roomTypeFor(shown) };
  if (type === "north_arrow") {
    const points = overlayGeometryPoints(geometry);
    const heading = headingFromGeometry(points);
    const keypoints = resolveCompassKeypoints({}, points, heading);
    if (keypoints.length) attributes.keypoints = serializeCompassKeypoints(keypoints);
  }
  return {
    id: newEntityId(),
    type,
    layer: ENTITY_LAYER[type],
    geometry,
    label: shown,
    confidence: 1,
    status: "user_edited",
    source,
    attributes,
    createdAt: now,
    updatedAt: now,
  };
}
