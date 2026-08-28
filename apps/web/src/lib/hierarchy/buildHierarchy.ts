import type {
  BuildingHierarchy,
  HierarchyFloor,
  HierarchyObject,
  HierarchyObjectKind,
  HierarchyRoom,
  HierarchyUnit,
  PlanEntityType,
} from "@highlife/shared-types";
import { COMMON_AREA_LABELS } from "@highlife/shared-types";
import type { OverlayEntity, OverlayGeometry } from "@/features/plan-editor/types";

type Pt = { x: number; y: number };

function pointsOf(geometry: OverlayGeometry): Pt[] {
  if (geometry.kind === "polygon" || geometry.kind === "mask" || geometry.kind === "polyline") {
    return geometry.points;
  }
  if (geometry.kind === "rect") {
    const { x, y, width, height } = geometry;
    return [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ];
  }
  if (geometry.kind === "point") {
    return [{ x: geometry.x, y: geometry.y }];
  }
  return [];
}

function bbox(pts: Pt[]): { x0: number; y0: number; x1: number; y1: number } | null {
  if (!pts.length) return null;
  let x0 = pts[0].x;
  let y0 = pts[0].y;
  let x1 = x0;
  let y1 = y0;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1 };
}

function centroid(pts: Pt[]): Pt | null {
  if (pts.length < 3) {
    const b = bbox(pts);
    return b ? { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 } : null;
  }
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-6) {
    const b = bbox(pts);
    return b ? { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 } : null;
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

function pointInPoly(px: number, py: number, poly: Pt[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi || 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function overlapFrac(a: NonNullable<ReturnType<typeof bbox>>, b: NonNullable<ReturnType<typeof bbox>>): number {
  const ix1 = Math.max(a.x0, b.x0);
  const iy1 = Math.max(a.y0, b.y0);
  const ix2 = Math.min(a.x1, b.x1);
  const iy2 = Math.min(a.y1, b.y1);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const area = Math.max(0, a.x1 - a.x0) * Math.max(0, a.y1 - a.y0);
  return area > 0 ? inter / area : 0;
}

function isCommonLabel(label: string): boolean {
  const n = label.trim().toLowerCase().replace(/[_-]+/g, " ");
  if ((COMMON_AREA_LABELS as readonly string[]).some((c) => c.toLowerCase() === n || c.toLowerCase().replace(/_/g, " ") === n)) {
    return true;
  }
  return n.includes("communal") || n.includes("lobby") || n.includes("common corridor");
}

function objectKind(type: PlanEntityType): HierarchyObjectKind {
  if (type === "door" || type === "window" || type === "fixture" || type === "stair") return type;
  return "other";
}

function bedroomish(t: string): boolean {
  return t.toLowerCase().includes("bed");
}
function bathroomish(t: string): boolean {
  const x = t.toLowerCase();
  return x.includes("bath") || x.includes("ensuite") || x.includes("toilet");
}

function normalizeUnitKey(label: string): string {
  return label.trim().toLowerCase().replace(/^unit\s+/, "").replace(/\s+/g, "");
}

function ocrUnitLabel(raw: string): string {
  const t = raw.trim();
  if (!t) return "Unit";
  if (/^unit[\s#:-]/i.test(t)) return t;
  return `Unit ${t}`;
}

/** Numeric then letter suffix, so Unit 2 < Unit 10 < Unit 10A. */
export function compareUnitLabels(a: string, b: string): number {
  const key = (label: string) => {
    const raw = label.trim();
    const stripped = raw.replace(/^unit[\s#:-]*/i, "").trim();
    const match = stripped.match(/(\d+)/);
    const n = match ? parseInt(match[1], 10) : Number.POSITIVE_INFINITY;
    const suffix = match
      ? stripped.slice(stripped.indexOf(match[1]) + match[1].length).replace(/^[\s._-]*/, "")
      : stripped;
    return { n, suffix: suffix.toLowerCase(), raw: raw.toLowerCase() };
  };
  const ka = key(a);
  const kb = key(b);
  if (ka.n !== kb.n) return ka.n - kb.n;
  const suffixCmp = ka.suffix.localeCompare(kb.suffix, undefined, { numeric: true });
  if (suffixCmp !== 0) return suffixCmp;
  return ka.raw.localeCompare(kb.raw, undefined, { numeric: true });
}

function sortUnitsByNumber<T extends { label: string }>(units: T[]): T[] {
  return [...units].sort((a, b) => compareUnitLabels(a.label, b.label));
}

function hierarchyUnitsFromOcr(pageId: string, ocrUnitIds: string[]): HierarchyUnit[] {
  const seen = new Set<string>();
  const units: HierarchyUnit[] = [];
  for (const raw of ocrUnitIds) {
    const label = ocrUnitLabel(raw);
    const key = normalizeUnitKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const safe = raw.trim().replace(/[^\w.-]+/g, "-") || "unit";
    units.push({
      id: `ocr-unit-${pageId}-${safe}`,
      label,
      areaM2: null,
      roomIds: [],
      bedroomCount: 0,
      bathroomCount: 0,
      confidence: 0.65,
      reviewRequired: true,
    });
  }
  return units;
}

function mergeOcrTextUnits(
  pageId: string,
  detected: HierarchyUnit[],
  ocrUnitIds: string[] | undefined,
): HierarchyUnit[] {
  const ocrUnits = hierarchyUnitsFromOcr(pageId, ocrUnitIds ?? []);
  if (!ocrUnits.length) return detected;

  const existing = new Set(detected.map((u) => normalizeUnitKey(u.label)));
  const extra = ocrUnits.filter((u) => !existing.has(normalizeUnitKey(u.label)));

  if (!detected.length) return ocrUnits;
  if (detected.length === 1 && detected[0].id.startsWith("unit-fallback-")) {
    if (!ocrUnits.length) return detected;
    const [first, ...rest] = ocrUnits;
    return [
      {
        ...first,
        roomIds: detected[0].roomIds,
        bedroomCount: detected[0].bedroomCount,
        bathroomCount: detected[0].bathroomCount,
      },
      ...rest,
    ];
  }
  return extra.length ? [...detected, ...extra] : detected;
}

export type FloorPageMeta = {
  pageId: string;
  pageNumber: number;
  levelName?: string | null;
  levelIndex?: number | null;
  floorId?: string | null;
  documentId?: string | null;
  sourceFileName?: string | null;
  isFloorPlan?: boolean;
  widthPx?: number;
  heightPx?: number;
  /** Unit labels parsed from title-block OCR (e.g. 5A, 101). */
  ocrUnitIds?: string[];
};

/**
 * Build Building → Floor → Unit → Room hierarchy from overlay entities (client-side).
 */
export function buildHierarchyFromOverlays(args: {
  analysisId: string;
  projectId: string;
  buildingName: string;
  pages: FloorPageMeta[];
  /** Entities keyed by pageNumber */
  entitiesByPage: Record<number, OverlayEntity[]>;
}): BuildingHierarchy {
  const now = new Date().toISOString();
  const rooms: HierarchyRoom[] = [];
  const units: HierarchyUnit[] = [];
  const objects: HierarchyObject[] = [];
  const floors: HierarchyFloor[] = [];

  const floorPlanPages = args.pages.filter((p) => p.isFloorPlan !== false);

  for (const page of floorPlanPages) {
    const entities = (args.entitiesByPage[page.pageNumber] ?? []).filter(
      (e) => e.status !== "rejected",
    );
    const roomEntities = entities.filter((e) => e.type === "room");
    const unitEntities = entities.filter((e) => e.type === "unit_boundary");
    const objectEntities = entities.filter((e) =>
      ["door", "window", "fixture", "stair"].includes(e.type),
    );

    const unitPolys = unitEntities.map((u) => ({
      id: u.id,
      label: u.label || "Unit",
      confidence: u.confidence,
      pts: pointsOf(u.geometry),
      box: bbox(pointsOf(u.geometry)),
    }));

    const pageRooms: HierarchyRoom[] = [];
    for (const r of roomEntities) {
      const pts = pointsOf(r.geometry);
      const c = centroid(pts);
      const rb = bbox(pts);
      const common = isCommonLabel(r.label);
      let unitId: string | null = null;
      if (!common && c) {
        let best: { id: string; score: number } | null = null;
        for (const u of unitPolys) {
          if (u.pts.length >= 3 && pointInPoly(c.x, c.y, u.pts)) {
            best = { id: u.id, score: 1 };
            break;
          }
          if (rb && u.box) {
            const frac = overlapFrac(rb, u.box);
            if (frac >= 0.5 && (!best || frac > best.score)) {
              best = { id: u.id, score: frac };
            }
          }
        }
        unitId = best?.id ?? null;
      }
      const room: HierarchyRoom = {
        id: r.id,
        label: r.label || "Room",
        roomType: r.label || "room",
        unitId,
        isCommon: common,
        areaM2: null,
        confidence: r.confidence,
        objectIds: [],
      };
      pageRooms.push(room);
      rooms.push(room);
    }

    const roomById = Object.fromEntries(pageRooms.map((r) => [r.id, r]));

    for (const o of objectEntities) {
      const c = centroid(pointsOf(o.geometry));
      let parentRoomId: string | null = null;
      if (c) {
        let bestArea = Infinity;
        for (const r of roomEntities) {
          const pts = pointsOf(r.geometry);
          const b = bbox(pts);
          const area = b ? (b.x1 - b.x0) * (b.y1 - b.y0) : Infinity;
          const inside =
            pts.length >= 3 ? pointInPoly(c.x, c.y, pts) : b
              ? c.x >= b.x0 && c.x <= b.x1 && c.y >= b.y0 && c.y <= b.y1
              : false;
          if (inside && area < bestArea) {
            bestArea = area;
            parentRoomId = r.id;
          }
        }
      }
      const parentUnitId = parentRoomId ? roomById[parentRoomId]?.unitId ?? null : null;
      const obj: HierarchyObject = {
        id: o.id,
        kind: objectKind(o.type),
        label: o.label || o.type,
        parentRoomId,
        parentUnitId,
        confidence: o.confidence,
      };
      objects.push(obj);
      if (parentRoomId && roomById[parentRoomId]) {
        roomById[parentRoomId].objectIds.push(o.id);
      }
    }

    let pageUnits: HierarchyUnit[] = [];
    if (unitPolys.length) {
      for (const u of unitPolys) {
        const roomIds = pageRooms.filter((r) => r.unitId === u.id && !r.isCommon).map((r) => r.id);
        const uRooms = roomIds.map((id) => roomById[id]).filter(Boolean);
        pageUnits.push({
          id: u.id,
          label: u.label,
          areaM2: null,
          roomIds,
          bedroomCount: uRooms.filter((r) => bedroomish(r.roomType)).length,
          bathroomCount: uRooms.filter((r) => bathroomish(r.roomType)).length,
          confidence: u.confidence,
          reviewRequired: true,
        });
      }
    } else {
      const privateRooms = pageRooms.filter((r) => !r.isCommon);
      const id = `unit-fallback-${page.pageId}`;
      for (const r of privateRooms) r.unitId = id;
      pageUnits.push({
        id,
        label: "Unit 1",
        areaM2: null,
        roomIds: privateRooms.map((r) => r.id),
        bedroomCount: privateRooms.filter((r) => bedroomish(r.roomType)).length,
        bathroomCount: privateRooms.filter((r) => bathroomish(r.roomType)).length,
        confidence: 0.5,
        reviewRequired: true,
      });
    }
    pageUnits = sortUnitsByNumber(mergeOcrTextUnits(page.pageId, pageUnits, page.ocrUnitIds));
    const fallbackId = `unit-fallback-${page.pageId}`;
    if (pageUnits.length && pageUnits.some((u) => u.id !== fallbackId)) {
      const primaryOcr = pageUnits.find((u) => u.id.startsWith("ocr-unit-"));
      if (primaryOcr) {
        for (const r of pageRooms) {
          if (r.unitId === fallbackId) r.unitId = primaryOcr.id;
        }
      }
    }
    units.push(...pageUnits);

    const commonAreaIds = pageRooms.filter((r) => r.isCommon).map((r) => r.id);
    const assigned = new Set(pageUnits.flatMap((u) => u.roomIds));
    const unassignedRoomIds = pageRooms
      .filter((r) => !r.isCommon && !assigned.has(r.id))
      .map((r) => r.id);

    floors.push({
      id: page.floorId || `floor-${page.pageId}`,
      levelName: page.levelName || `Floor ${page.pageNumber}`,
      levelIndex: page.levelIndex ?? page.pageNumber - 1,
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      documentId: page.documentId ?? null,
      sourceFileName: page.sourceFileName ?? null,
      isFloorPlan: true,
      unitIds: pageUnits.map((u) => u.id),
      commonAreaIds,
      unassignedRoomIds,
      properties: {
        unitCount: pageUnits.length,
        roomCount: pageRooms.length,
        commonAreaCount: commonAreaIds.length,
        grossAreaM2: null,
        commonAreaM2: null,
      },
    });
  }

  floors.sort((a, b) => a.levelIndex - b.levelIndex || a.pageNumber - b.pageNumber);

  return {
    schemaVersion: "1.0.0",
    buildingId: args.projectId,
    projectId: args.projectId,
    analysisId: args.analysisId,
    name: args.buildingName,
    floors,
    units,
    rooms,
    objects,
    createdAt: now,
    updatedAt: now,
  };
}
