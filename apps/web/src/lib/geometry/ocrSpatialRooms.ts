import { overlayGeometryPoints, pointInPolygon } from "@/features/plan-editor/geometry";
import { isUnitOutlineEntity } from "@/features/plan-editor/labelClasses";
import type { OverlayEntity } from "@/features/plan-editor/types";
import type { DrawingOcrLine } from "@/lib/hierarchy/inferUnitBoundaries";
import { applyOcrRoomDimensions } from "./applyOcrRoomDimensions";
import {
  extractOcrRoomSeeds,
  ocrTextToRoomLabel,
  type OcrRoomSeed,
} from "./matchOcrRoomLabels";
import {
  isOpenPlanLabel,
  mergeOpenPlanLabels,
  openPlanKindsFromText,
} from "./openPlanRoom";
import type { ExtractedGeometryRoom, Pt } from "./wallBoundedRooms";

export type OcrRoomCategory =
  | "living"
  | "kitchen"
  | "bedroom"
  | "bathroom"
  | "robe"
  | "dining"
  | "other";

export type UnitBoundaryClip = {
  unitId: string;
  unitLabel: string;
  points: Pt[];
};

export type OcrSpatialRoom = {
  id: string;
  label: string;
  category: OcrRoomCategory;
  text: string;
  centroid: Pt;
  unitId: string | null;
  unitLabel: string | null;
};

/** Categories that should appear at most once per unit (typical apartment layout). */
export const UNIQUE_UNIT_ROOM_CATEGORIES: OcrRoomCategory[] = ["living", "kitchen"];

export function ocrRoomCategoryFromLabel(label: string): OcrRoomCategory {
  const kinds = openPlanKindsFromText(label);
  if (kinds.length >= 2) return "living";
  if (kinds.includes("living")) return "living";
  if (kinds.includes("kitchen")) return "kitchen";
  if (kinds.includes("dining")) return "dining";
  const n = label.trim().toLowerCase();
  if (n.includes("bedroom") || n.startsWith("bed ")) return "bedroom";
  if (n.includes("robe") || n.includes("wardrobe")) return "robe";
  if (n.includes("bath") || n.includes("ensuite") || n.includes("toilet")) return "bathroom";
  return "other";
}

export function unitBoundariesFromEntities(
  entities: Pick<OverlayEntity, "id" | "type" | "label" | "geometry" | "status">[],
): UnitBoundaryClip[] {
  const clips: UnitBoundaryClip[] = [];
  for (const entity of entities) {
    if (entity.status === "rejected" || !isUnitOutlineEntity(entity)) continue;
    const points = overlayGeometryPoints(entity.geometry);
    if (points.length < 3) continue;
    clips.push({
      unitId: entity.id,
      unitLabel: entity.label?.trim() || "Unit",
      points: points.map((p) => ({ x: p.x, y: p.y })),
    });
  }
  return clips;
}

function polyArea(pts: Pt[]): number {
  if (pts.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area * 0.5);
}

function centroidOf(pts: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  const n = Math.max(1, pts.length);
  return { x: x / n, y: y / n };
}

function pointInRing(pt: Pt, ring: Pt[]): boolean {
  return pointInPolygon(
    { x: pt.x, y: pt.y },
    ring.map((p) => ({ x: p.x, y: p.y })),
  );
}

function sameUnitRoom(a: ExtractedGeometryRoom, unitId: string | null, unitLabel: string | null): boolean {
  if (unitId && a.unitId) return a.unitId === unitId;
  if (unitLabel && a.unitLabel) {
    return a.unitLabel.trim().toLowerCase() === unitLabel.trim().toLowerCase();
  }
  if (!unitId && !unitLabel) return !a.unitId && !a.unitLabel;
  return false;
}

/** Categories where OCR text must sit inside the flood-filled room — never snap to nearest centroid. */
const STRICT_INSIDE_CATEGORIES: OcrRoomCategory[] = ["bedroom", "bathroom", "robe"];

function seedRoomMatchScore(
  seed: OcrSpatialRoom,
  room: ExtractedGeometryRoom,
): number | null {
  if (seed.unitId || seed.unitLabel) {
    if (!sameUnitRoom(room, seed.unitId, seed.unitLabel)) return null;
  }
  const rc = roomCentroid(room);
  const inside = pointInRing(seed.centroid, room.points);
  const d = Math.hypot(seed.centroid.x - rc.x, seed.centroid.y - rc.y);
  if (STRICT_INSIDE_CATEGORIES.includes(seed.category)) {
    return inside ? d : null;
  }
  return inside ? d : d + 4000;
}

function seedSortPriority(seed: OcrSpatialRoom): number {
  const m = seed.label.match(/\b(\d+)\b/);
  return m ? 0 : 1;
}

function genericRoomLabel(label: string): boolean {
  const n = label.trim().toLowerCase();
  return n === "room" || n === "space" || n === "area" || n.startsWith("room ");
}

/** Map OCR text positions to unit boundaries (point-in-polygon, smallest unit when nested). */
export function assignOcrSeedsToUnits(
  seeds: OcrRoomSeed[],
  units: UnitBoundaryClip[],
): OcrSpatialRoom[] {
  const unitById = new Map(units.map((u) => [u.unitId, u]));

  return seeds.map((seed, index) => {
    let unitId: string | null = null;
    let unitLabel: string | null = null;

    const containing = units.filter((u) => pointInRing(seed.centroid, u.points));
    if (containing.length === 1) {
      unitId = containing[0].unitId;
      unitLabel = containing[0].unitLabel;
    } else if (containing.length > 1) {
      const smallest = containing.reduce((best, u) =>
        polyArea(u.points) < polyArea(best.points) ? u : best,
      );
      unitId = smallest.unitId;
      unitLabel = smallest.unitLabel;
    } else if (units.length > 0) {
      let best: UnitBoundaryClip | null = null;
      let bestDist = Infinity;
      for (const u of units) {
        const c = centroidOf(u.points);
        const d = Math.hypot(seed.centroid.x - c.x, seed.centroid.y - c.y);
        if (d < bestDist) {
          bestDist = d;
          best = u;
        }
      }
      if (best && bestDist <= 1500) {
        unitId = best.unitId;
        unitLabel = best.unitLabel;
      }
    }

    return {
      id: `ocr-room-${index}-${Math.round(seed.centroid.x)}-${Math.round(seed.centroid.y)}`,
      label: seed.label,
      category: ocrRoomCategoryFromLabel(seed.label),
      text: seed.text,
      centroid: seed.centroid,
      unitId,
      unitLabel,
    };
  });
}

/** Keep one living and one kitchen label per unit (closest to unit centroid wins). */
export function dedupePerUnitRoomCategories(
  rooms: OcrSpatialRoom[],
  units: UnitBoundaryClip[],
  categories: OcrRoomCategory[] = UNIQUE_UNIT_ROOM_CATEGORIES,
): OcrSpatialRoom[] {
  const unitById = new Map(units.map((u) => [u.unitId, u]));
  const drop = new Set<string>();

  const byUnit = new Map<string, OcrSpatialRoom[]>();
  for (const room of rooms) {
    const key = room.unitId ?? "__unassigned__";
    const list = byUnit.get(key) ?? [];
    list.push(room);
    byUnit.set(key, list);
  }

  for (const [unitKey, list] of byUnit) {
    for (const category of categories) {
      const matches = list.filter((r) => r.category === category);
      if (matches.length <= 1) continue;

      const unit = unitKey !== "__unassigned__" ? unitById.get(unitKey) : null;
      const ref = unit ? centroidOf(unit.points) : centroidOf(matches.map((m) => m.centroid));

      let best = matches[0];
      let bestDist = Math.hypot(best.centroid.x - ref.x, best.centroid.y - ref.y);
      for (let i = 1; i < matches.length; i++) {
        const d = Math.hypot(matches[i].centroid.x - ref.x, matches[i].centroid.y - ref.y);
        if (d < bestDist) {
          bestDist = d;
          best = matches[i];
        }
      }
      for (const m of matches) {
        if (m.id !== best.id) drop.add(m.id);
      }
    }
  }

  return rooms.filter((r) => !drop.has(r.id));
}

function unitSize(unit: UnitBoundaryClip | null): number {
  if (!unit || unit.points.length < 2) return 96;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of unit.points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return Math.max(80, Math.min(160, 0.16 * Math.max(x1 - x0, y1 - y0)));
}

/** Merge living / dining / kitchen OCR that sits in the same open-plan space. */
export function clusterNearbyOpenPlanRooms(
  rooms: OcrSpatialRoom[],
  units: UnitBoundaryClip[],
): OcrSpatialRoom[] {
  const unitById = new Map(units.map((u) => [u.unitId, u]));
  const byUnit = new Map<string, OcrSpatialRoom[]>();
  const passthrough: OcrSpatialRoom[] = [];
  for (const room of rooms) {
    if (!isOpenPlanLabel(room.label)) {
      passthrough.push(room);
      continue;
    }
    const key = room.unitId ?? "__unassigned__";
    const list = byUnit.get(key) ?? [];
    list.push(room);
    byUnit.set(key, list);
  }

  const clustered: OcrSpatialRoom[] = [];
  for (const [unitKey, list] of byUnit) {
    const unit = unitKey !== "__unassigned__" ? unitById.get(unitKey) ?? null : null;
    const maxDist = unitSize(unit);
    const used = new Set<number>();
    for (let i = 0; i < list.length; i++) {
      if (used.has(i)) continue;
      const group = [list[i]];
      used.add(i);
      for (let j = i + 1; j < list.length; j++) {
        if (used.has(j)) continue;
        const near = group.some(
          (g) => Math.hypot(g.centroid.x - list[j].centroid.x, g.centroid.y - list[j].centroid.y) <= maxDist,
        );
        if (!near) continue;
        group.push(list[j]);
        used.add(j);
      }
      if (group.length === 1) {
        clustered.push(group[0]);
        continue;
      }
      const label = mergeOpenPlanLabels(...group.map((g) => g.label)) ?? group[0].label;
      const cx = group.reduce((s, g) => s + g.centroid.x, 0) / group.length;
      const cy = group.reduce((s, g) => s + g.centroid.y, 0) / group.length;
      clustered.push({
        ...group[0],
        id: `${group[0].id}-openplan`,
        label,
        category: ocrRoomCategoryFromLabel(label),
        text: group.map((g) => g.text).join(" / "),
        centroid: { x: cx, y: cy },
      });
    }
  }

  return [...passthrough, ...clustered];
}

export function buildSpatialOcrRooms(
  lines: DrawingOcrLine[] | null | undefined,
  units: UnitBoundaryClip[],
): OcrSpatialRoom[] {
  const seeds = extractOcrRoomSeeds(lines);
  const assigned = assignOcrSeedsToUnits(seeds, units);
  return dedupePerUnitRoomCategories(clusterNearbyOpenPlanRooms(assigned, units), units);
}

function makeOcrAnchorRoom(seed: OcrSpatialRoom, radiusPx = 36): ExtractedGeometryRoom {
  const { x, y } = seed.centroid;
  const points: Pt[] = [
    { x: x - radiusPx, y: y - radiusPx },
    { x: x + radiusPx, y: y - radiusPx },
    { x: x + radiusPx, y: y + radiusPx },
    { x: x - radiusPx, y: y + radiusPx },
  ];
  const side = radiusPx * 2;
  return {
    id: seed.id,
    label: seed.label,
    unitId: seed.unitId,
    unitLabel: seed.unitLabel,
    isCommon: false,
    points,
    areaPx2: side * side,
    widthPx: side,
    depthPx: side,
    perimeterPx: side * 4,
    areaM2: null,
    widthM: null,
    depthM: null,
    perimeterM: null,
    adjacentIds: [],
    adjacentLabels: [],
    openings: { doors: [], windows: [] },
  };
}

function roomCentroid(room: ExtractedGeometryRoom): Pt {
  return centroidOf(room.points);
}

/**
 * Place OCR room labels in unit space, match to flood-filled rooms within the same unit,
 * and add anchor nodes for unmatched labels (e.g. living / kitchen when geometry is missing).
 */
export function mergeSpatialOcrIntoRooms(
  rooms: ExtractedGeometryRoom[],
  lines: DrawingOcrLine[] | null | undefined,
  entities: Pick<OverlayEntity, "id" | "type" | "label" | "geometry" | "status">[],
): { rooms: ExtractedGeometryRoom[]; ocrRooms: OcrSpatialRoom[] } {
  const units = unitBoundariesFromEntities(entities);
  const ocrRooms = buildSpatialOcrRooms(lines, units);
  if (!ocrRooms.length) return { rooms: applyOcrRoomDimensions(rooms, lines), ocrRooms };

  const usedSeed = new Set<string>();
  const usedRoomIdx = new Set<number>();
  const updated = rooms.map((room) => ({ ...room }));

  const sortedSeeds = [...ocrRooms].sort(
    (a, b) => seedSortPriority(a) - seedSortPriority(b) || a.label.localeCompare(b.label),
  );

  for (const seed of sortedSeeds) {
    let bestIdx = -1;
    let bestScore = Infinity;

    for (let i = 0; i < updated.length; i++) {
      if (usedRoomIdx.has(i)) continue;
      const score = seedRoomMatchScore(seed, updated[i]);
      if (score == null || score >= bestScore) continue;
      bestScore = score;
      bestIdx = i;
    }

    if (bestIdx < 0 || bestScore > 6000) continue;

    const target = updated[bestIdx];
    const targetCategory = ocrRoomCategoryFromLabel(target.label);
    const openPlanTogether = isOpenPlanLabel(target.label) && isOpenPlanLabel(seed.label);
    const canReplace =
      genericRoomLabel(target.label) ||
      targetCategory === seed.category ||
      openPlanTogether;

    if (!canReplace) continue;

    usedSeed.add(seed.id);
    usedRoomIdx.add(bestIdx);
    const label = openPlanTogether
      ? mergeOpenPlanLabels(target.label, seed.label) ?? seed.label
      : seed.label;
    updated[bestIdx] = {
      ...target,
      label,
      unitId: target.unitId ?? seed.unitId,
      unitLabel: target.unitLabel ?? seed.unitLabel,
    };
  }

  const anchors: ExtractedGeometryRoom[] = [];
  for (const seed of ocrRooms) {
    if (usedSeed.has(seed.id)) continue;
    if (!seed.unitId && !seed.unitLabel) continue;
    if (isOpenPlanLabel(seed.label)) {
      const covered = updated.some((room) => {
        if (!sameUnitRoom(room, seed.unitId, seed.unitLabel)) return false;
        if (!isOpenPlanLabel(room.label)) return false;
        return pointInRing(seed.centroid, room.points);
      });
      if (covered) continue;
    }
    anchors.push(makeOcrAnchorRoom(seed));
  }

  return { rooms: applyOcrRoomDimensions([...updated, ...anchors], lines), ocrRooms };
}

/** @deprecated Use mergeSpatialOcrIntoRooms — kept for callers that only need relabeled rooms. */
export function enrichRoomsWithSpatialOcr(
  rooms: ExtractedGeometryRoom[],
  lines: DrawingOcrLine[] | null | undefined,
  entities: Pick<OverlayEntity, "id" | "type" | "label" | "geometry" | "status">[],
): ExtractedGeometryRoom[] {
  return mergeSpatialOcrIntoRooms(rooms, lines, entities).rooms;
}

export { ocrTextToRoomLabel };
