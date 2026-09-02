import { COMMON_AREA_LABELS } from "@highlife/shared-types";
import { ENTITY_LAYER, type OverlayEntity, type OverlayGeometry } from "@/features/plan-editor/types";
import { parseUnitIds } from "@/lib/hierarchy/pageLevel";
import {
  barrierEntitiesForUnitInference,
  resolveUnitBoundaryHeadMode,
} from "@/lib/hierarchy/unitBoundaryHead";
import {
  buildCommunalSeedPoints,
  classifyUnitEntranceDoors,
  communalRegionCentroid,
  doorOpeningSpanFromPoints,
  isExplicitMainDoorLabel,
  minDistToPolygon,
  unitSeedBehindMainDoor,
  type MainDoorWidthOpts,
} from "@/lib/hierarchy/communalMainDoor";

export type Pt = { x: number; y: number };

export type InferOverlayEntity = {
  id: string;
  type: string;
  label: string;
  geometry: OverlayGeometry;
  source?: string;
  status?: string;
  attributes?: Record<string, unknown>;
  confidence?: number;
};

export type DrawingOcrLine = {
  text?: string | null;
  confidence?: number | null;
  bbox?: [number, number][] | null;
};

export type InferredUnitMethod =
  | "yolo"
  | "room_door_cluster"
  | "ocr_room_nearest"
  | "wall_flood_fill"
  | "communal_main_door"
  | "communal_residual";

export type InferredUnitBoundary = {
  id: string;
  label: string;
  unitId: string;
  points: Pt[];
  method: InferredUnitMethod;
  reviewRequired: boolean;
  roomIds: string[];
  entranceIds: string[];
  confidence: number;
};

export type YoloLabelPatch = {
  id: string;
  label: string;
  attributes: Record<string, unknown>;
};

export type InferUnitBoundariesInput = {
  entities: InferOverlayEntity[];
  drawingOcrMeta?: { lines?: DrawingOcrLine[] | null } | null;
  widthPx: number;
  heightPx: number;
  pageNumber?: number;
  /** Width-based main door classification (threshold or auto split). */
  mainDoorWidth?: MainDoorWidthOpts;
};

export type InferUnitBoundariesResult = {
  units: InferredUnitBoundary[];
  createdEntities: OverlayEntity[];
  yoloLabelPatches: YoloLabelPatch[];
};

type Box = { x0: number; y0: number; x1: number; y1: number };

const UNIT_PREFIX_ONLY_RE = /^(?:unit|apt|apartment|dwelling|tenancy|flat|suite|u)\.?$/i;
const BARE_UNIT_NUMBER_RE = /^#?\s*(\d{1,4}[A-Za-z]?)$/;

function normLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[_-]+/g, " ");
}

export function isExternalWallLabel(label: string): boolean {
  const n = normLabel(label);
  return n === "external wall" || n === "external_wall" || n.includes("external wall");
}

/** Skip solid fill only for page-scale external outlines, not wall segments between units. */
export function isEnvelopeOutlineWall(
  wall: { label: string; box: Box },
  widthPx: number,
  heightPx: number,
): boolean {
  if (!isExternalWallLabel(wall.label)) return false;
  const w = wall.box.x1 - wall.box.x0;
  const h = wall.box.y1 - wall.box.y0;
  const minSide = Math.min(w, h);
  const maxSide = Math.max(w, h);
  const pageMax = Math.max(widthPx, heightPx);
  if (minSide < pageMax * 0.06) return false;
  return maxSide > pageMax * 0.35 && minSide > pageMax * 0.06;
}

export function isCommonRoomLabel(label: string): boolean {
  const n = normLabel(label);
  if ((COMMON_AREA_LABELS as readonly string[]).some((c) => normLabel(c) === n)) return true;
  return (
    n.includes("communal") ||
    n.includes("lobby") ||
    n.includes("common corridor") ||
    n === "corridor" ||
    n === "hallway" ||
    n === "hall" ||
    n === "foyer" ||
    n === "vestibule" ||
    n === "lift" ||
    n === "elevator" ||
    n === "stair" ||
    n === "stairs" ||
    n.includes("stairwell")
  );
}

export function isMainDoorLabel(label: string): boolean {
  return isExplicitMainDoorLabel(label);
}

export function isInternalDoorLabel(label: string): boolean {
  const n = normLabel(label);
  return n.includes("door") && !isMainDoorLabel(label);
}

/** Unit token only when the line names a dwelling (`Unit 101`, `APT 203`, `U34`). */
export function parseUnitTokenFromLine(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const trimmed = text.trim();
  if (trimmed.includes(":")) return null;
  return parseUnitIds(trimmed, 1)[0] ?? null;
}

export function formatUnitLabel(unitId: string, style?: "apartment" | "unit"): string {
  const t = unitId.trim();
  if (!t) return "Unit";
  if (style === "apartment") return `Apartment ${t}`;
  if (/^apartment[\s#:-]/i.test(t)) return t;
  if (/^unit[\s#:-]/i.test(t)) return t;
  return `Unit ${t}`;
}

function unitLabelForSeed(seed: OcrSeed): string {
  return formatUnitLabel(seed.unitId, seed.labelStyle);
}

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
  if (geometry.kind === "point") return [{ x: geometry.x, y: geometry.y }];
  return [];
}

function bboxOf(pts: Pt[]): Box | null {
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

function centroidOf(pts: Pt[]): Pt | null {
  if (pts.length < 3) {
    const b = bboxOf(pts);
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
    const b = bboxOf(pts);
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

function expandBox(box: Box, pad: number): Box {
  return { x0: box.x0 - pad, y0: box.y0 - pad, x1: box.x1 + pad, y1: box.y1 + pad };
}

function pointInBox(px: number, py: number, box: Box): boolean {
  return px >= box.x0 && px <= box.x1 && py >= box.y0 && py <= box.y1;
}

function dist2(a: Pt, b: Pt): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function entityPoints(entity: InferOverlayEntity): Pt[] {
  return pointsOf(entity.geometry);
}

function entityCentroid(entity: InferOverlayEntity): Pt | null {
  return centroidOf(entityPoints(entity));
}

function entityBox(entity: InferOverlayEntity): Box | null {
  return bboxOf(entityPoints(entity));
}

function attrLabel(entity: InferOverlayEntity): string {
  const fromAttr = entity.attributes?.label;
  if (typeof fromAttr === "string" && fromAttr.trim()) return fromAttr;
  return entity.label;
}

function isRejected(entity: InferOverlayEntity): boolean {
  return entity.status === "rejected";
}

function isYoloUnit(entity: InferOverlayEntity): boolean {
  if (entity.source === "inferred") return false;
  if (entity.type === "unit_boundary") return true;
  const label = (entity.label ?? "").trim();
  return /^unit(\b|\s)/i.test(label);
}

type OcrSeed = { unitId: string; centroid: Pt; poly: Pt[]; labelStyle?: "apartment" | "unit" };

function prefixNumberAdjacent(prefix: Box, number: Box): boolean {
  const size = Math.max(prefix.x1 - prefix.x0, prefix.y1 - prefix.y0, 8);
  const vOverlap = Math.min(prefix.y1, number.y1) - Math.max(prefix.y0, number.y0);
  const hOverlap = Math.min(prefix.x1, number.x1) - Math.max(prefix.x0, number.x0);
  const gapRight = number.x0 - prefix.x1;
  const gapBelow = number.y0 - prefix.y1;
  const toRight = vOverlap > size * 0.25 && gapRight >= -size * 0.4 && gapRight <= size * 3.5;
  const below = hOverlap > size * 0.25 && gapBelow >= -size * 0.4 && gapBelow <= size * 3.5;
  return toRight || below;
}

export function extractDrawingUnitLabels(
  lines: DrawingOcrLine[] | null | undefined,
  opts?: { drawingArea?: Pt[] | null; titleBlock?: Pt[] | null },
): OcrSeed[] {
  const seeds: OcrSeed[] = [];
  const seen = new Set<string>();
  const leftover: { text: string; poly: Pt[]; centroid: Pt; box: Box }[] = [];

  const inScope = (centroid: Pt) => {
    if (opts?.titleBlock && opts.titleBlock.length >= 3 && pointInPoly(centroid.x, centroid.y, opts.titleBlock)) {
      return false;
    }
    if (opts?.drawingArea && opts.drawingArea.length >= 3 && !pointInPoly(centroid.x, centroid.y, opts.drawingArea)) {
      return false;
    }
    return true;
  };

  const pushSeed = (unitId: string, poly: Pt[], centroid: Pt, labelStyle?: OcrSeed["labelStyle"]) => {
    const key = `${unitId}:${Math.round(centroid.x)}:${Math.round(centroid.y)}`;
    if (seen.has(key)) return;
    seen.add(key);
    seeds.push({ unitId, centroid, poly, labelStyle });
  };

  for (const line of lines ?? []) {
    const text = line.text?.trim() ?? "";
    const bbox = line.bbox;
    if (!text || !bbox || bbox.length < 2) continue;
    const poly = bbox.map(([x, y]) => ({ x, y }));
    const centroid = centroidOf(poly);
    const box = bboxOf(poly);
    if (!centroid || !box || !inScope(centroid)) continue;
    const unitId = parseUnitTokenFromLine(text);
    if (unitId) {
      const style = /^apartment\b/i.test(text) ? "apartment" : "unit";
      pushSeed(unitId, poly, centroid, style);
      continue;
    }
    leftover.push({ text, poly, centroid, box });
  }

  const prefixes = leftover.filter((l) => UNIT_PREFIX_ONLY_RE.test(l.text));
  const numbers = leftover.filter((l) => BARE_UNIT_NUMBER_RE.test(l.text));
  const usedNumber = new Set<number>();
  for (const prefix of prefixes) {
    let best = -1;
    let bestDist = Infinity;
    numbers.forEach((num, i) => {
      if (usedNumber.has(i) || !prefixNumberAdjacent(prefix.box, num.box)) return;
      const dx = num.centroid.x - prefix.centroid.x;
      const dy = num.centroid.y - prefix.centroid.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    if (best < 0) continue;
    const num = numbers[best];
    const token = num ? BARE_UNIT_NUMBER_RE.exec(num.text)?.[1] : null;
    if (!num || !token) continue;
    usedNumber.add(best);
    const style = /^apartment$/i.test(prefix.text.trim()) ? "apartment" : "unit";
    pushSeed(token.toUpperCase(), num.poly, num.centroid, style);
  }

  return seeds;
}

const COMMUNAL_OCR_RE =
  /\b(?:lobby|foyer|vestibule|corridor|hallway|hall|lift\s*lobby|common\s*corridor|communal(?:\s+(?:space|area))?|elevator|lift|stair(?:s|well|case)?)\b/i;

export function isCommunalOcrText(text: string | null | undefined): boolean {
  if (!text?.trim()) return false;
  if (parseUnitTokenFromLine(text)) return false;
  return COMMUNAL_OCR_RE.test(text.trim());
}

export type CommunalOcrSeed = { label: string; centroid: Pt; poly: Pt[] };

export function extractCommunalOcrSeeds(
  lines: DrawingOcrLine[] | null | undefined,
  opts?: { drawingArea?: Pt[] | null; titleBlock?: Pt[] | null },
): CommunalOcrSeed[] {
  const seeds: CommunalOcrSeed[] = [];
  const seen = new Set<string>();

  const inScope = (centroid: Pt) => {
    if (opts?.titleBlock && opts.titleBlock.length >= 3 && pointInPoly(centroid.x, centroid.y, opts.titleBlock)) {
      return false;
    }
    if (opts?.drawingArea && opts.drawingArea.length >= 3 && !pointInPoly(centroid.x, centroid.y, opts.drawingArea)) {
      return false;
    }
    return true;
  };

  for (const line of lines ?? []) {
    const text = line.text?.trim() ?? "";
    const bbox = line.bbox;
    if (!text || !bbox || bbox.length < 2 || !isCommunalOcrText(text)) continue;
    const poly = bbox.map(([x, y]) => ({ x, y }));
    const centroid = centroidOf(poly);
    if (!centroid || !inScope(centroid)) continue;
    const key = `${Math.round(centroid.x / 8)}:${Math.round(centroid.y / 8)}:${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    seeds.push({ label: text, centroid, poly });
  }
  return seeds;
}

type IndexedShape = {
  entity: InferOverlayEntity;
  points: Pt[];
  box: Box;
  centroid: Pt;
  label: string;
};

function indexShapes(entities: InferOverlayEntity[], type: string): IndexedShape[] {
  const out: IndexedShape[] = [];
  for (const entity of entities) {
    if (entity.type !== type || isRejected(entity)) continue;
    const points = entityPoints(entity);
    const box = bboxOf(points);
    const centroid = centroidOf(points);
    if (!box || !centroid) continue;
    out.push({ entity, points, box, centroid, label: attrLabel(entity) });
  }
  return out;
}

function assignLabelsGreedy<T extends { centroid: Pt }>(
  items: T[],
  seeds: OcrSeed[],
): Map<number, OcrSeed> {
  const assigned = new Map<number, OcrSeed>();
  const usedSeed = new Set<number>();
  const pairs: { item: number; seed: number; d: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let s = 0; s < seeds.length; s++) {
      pairs.push({ item: i, seed: s, d: dist2(items[i].centroid, seeds[s].centroid) });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  for (const p of pairs) {
    if (assigned.has(p.item) || usedSeed.has(p.seed)) continue;
    assigned.set(p.item, seeds[p.seed]);
    usedSeed.add(p.seed);
  }
  return assigned;
}

function nearestOcrSeed(centroid: Pt, seeds: OcrSeed[]): OcrSeed | null {
  let best: OcrSeed | null = null;
  let bestD = Infinity;
  for (const seed of seeds) {
    const d = dist2(centroid, seed.centroid);
    if (d < bestD) {
      bestD = d;
      best = seed;
    }
  }
  return best;
}

/** Nearest apartment label per region; the same apartment may claim several regions (e.g. balcony + core). */
function assignNearestSeeds<T extends { centroid: Pt }>(
  items: T[],
  seeds: OcrSeed[],
  maxDist2?: number,
): Map<number, OcrSeed> {
  const assigned = new Map<number, OcrSeed>();
  for (let i = 0; i < items.length; i++) {
    const seed = nearestOcrSeed(items[i].centroid, seeds);
    if (!seed) continue;
    if (maxDist2 != null && dist2(items[i].centroid, seed.centroid) > maxDist2) continue;
    assigned.set(i, seed);
  }
  return assigned;
}

function mergeUnitGeometry(
  target: InferredUnitBoundary,
  extra: { points: Pt[]; entranceIds: string[]; roomIds: string[] },
): void {
  const hull = convexHull([...target.points, ...extra.points]);
  if (hull.length >= 3) target.points = hull;
  target.entranceIds = [...new Set([...target.entranceIds, ...extra.entranceIds])];
  target.roomIds = [...new Set([...target.roomIds, ...extra.roomIds])];
}

function nearestUnitByCentroid(centroid: Pt, units: InferredUnitBoundary[]): InferredUnitBoundary | null {
  let best: InferredUnitBoundary | null = null;
  let bestD = Infinity;
  for (const unit of units) {
    const c = centroidOf(unit.points) ?? unit.points[0];
    const d = dist2(centroid, c);
    if (d < bestD) {
      bestD = d;
      best = unit;
    }
  }
  return best;
}

function apartmentLinkDist2(widthPx: number, heightPx: number, pad: number): number {
  const span = Math.max(pad * 14, Math.min(widthPx, heightPx) * 0.42);
  return span * span;
}

function nextAnonymousUnitId(units: InferredUnitBoundary[]): string {
  const used = new Set(units.map((u) => u.unitId));
  for (let n = 1; n < 999; n++) {
    const id = String(n);
    if (!used.has(id) && !used.has(`U${id}`)) return `U${n}`;
  }
  return `U${units.length + 1}`;
}

function absorbOrphanRegion(
  region: { points: Pt[]; entranceIds: string[]; roomIds: string[] },
  centroid: Pt,
  units: InferredUnitBoundary[],
  ocrSeeds: OcrSeed[],
  linkDist2: number,
): boolean {
  const seed = nearestOcrSeed(centroid, ocrSeeds);
  if (seed) {
    const existing = units.find((u) => u.unitId === seed.unitId);
    if (existing) {
      mergeUnitGeometry(existing, region);
      return true;
    }
  }
  if (!ocrSeeds.length) return false;
  const neighbor = nearestUnitByCentroid(centroid, units);
  if (!neighbor) return false;
  const nc = centroidOf(neighbor.points) ?? neighbor.points[0];
  if (dist2(centroid, nc) > linkDist2) return false;
  mergeUnitGeometry(neighbor, region);
  return true;
}

function resolveUnitFromRegion(
  centroid: Pt,
  payload: { points: Pt[]; entranceIds: string[]; roomIds: string[] },
  units: InferredUnitBoundary[],
  seeds: OcrSeed[],
  linkDist2: number,
  assignedSeed?: OcrSeed | null,
): { unitId: string; seed: OcrSeed | null } | null {
  if (assignedSeed) return { unitId: assignedSeed.unitId, seed: assignedSeed };
  if (seeds.length) {
    const seed = nearestOcrSeed(centroid, seeds);
    if (seed) return { unitId: seed.unitId, seed };
    if (absorbOrphanRegion(payload, centroid, units, seeds, linkDist2)) return null;
    return null;
  }
  if (absorbOrphanRegion(payload, centroid, units, seeds, linkDist2)) return null;
  return { unitId: nextAnonymousUnitId(units), seed: null };
}

class UnionFind {
  parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    return this.parent[i] === i ? i : (this.parent[i] = this.find(this.parent[i]));
  }
  union(a: number, b: number): void {
    const pa = this.find(a);
    const pb = this.find(b);
    if (pa !== pb) this.parent[pa] = pb;
  }
}

function clusterPrivateRoomsByDoors(
  rooms: IndexedShape[],
  doors: IndexedShape[],
  padPx: number,
  isMainDoorFn: (door: IndexedShape) => boolean = isMainDoorLabel,
): { roomIndexes: number[]; entranceIds: string[] }[] {
  const privateRooms = rooms
    .map((r, roomIndex) => ({ r, roomIndex }))
    .filter(({ r }) => !isCommonRoomLabel(r.label));
  const commonRooms = rooms.filter((r) => isCommonRoomLabel(r.label));
  if (!privateRooms.length) return [];

  const uf = new UnionFind(privateRooms.length);
  const entrancesByPrivate = new Map<number, string[]>();

  const near = (door: IndexedShape, room: IndexedShape) =>
    pointInBox(door.centroid.x, door.centroid.y, expandBox(room.box, padPx));

  for (const door of doors) {
    const nearPrivate = privateRooms
      .map((p, i) => ({ ...p, i }))
      .filter(({ r }) => near(door, r));
    const nearCommon = commonRooms.some((r) => near(door, r));
    const main = isMainDoorFn(door);

    if (nearPrivate.length >= 2 && !main) {
      for (let i = 1; i < nearPrivate.length; i++) {
        uf.union(nearPrivate[0].i, nearPrivate[i].i);
      }
    }

    if ((main || nearCommon) && nearPrivate.length >= 1) {
      for (const hit of nearPrivate) {
        const list = entrancesByPrivate.get(hit.i) ?? [];
        list.push(door.entity.id);
        entrancesByPrivate.set(hit.i, list);
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < privateRooms.length; i++) {
    const root = uf.find(i);
    const list = groups.get(root) ?? [];
    list.push(privateRooms[i].roomIndex);
    groups.set(root, list);
  }

  return [...groups.values()].map((roomIndexes) => {
    const entranceIds: string[] = [];
    const seen = new Set<string>();
    const privateIdxByRoom = new Map(privateRooms.map((p, i) => [p.roomIndex, i]));
    for (const idx of roomIndexes) {
      const pi = privateIdxByRoom.get(idx);
      if (pi == null) continue;
      for (const id of entrancesByPrivate.get(pi) ?? []) {
        if (seen.has(id)) continue;
        seen.add(id);
        entranceIds.push(id);
      }
    }
    return { roomIndexes, entranceIds };
  });
}

function hullFromRooms(rooms: IndexedShape[], indexes: number[]): Pt[] {
  const pts: Pt[] = [];
  for (const i of indexes) pts.push(...rooms[i].points);
  const hull = convexHull(pts);
  return hull.length >= 3 ? hull : pts;
}

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

function simplifyRdp(points: Pt[], eps: number): Pt[] {
  if (points.length <= 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  let maxD = 0;
  let maxI = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], first, last);
    if (d > maxD) {
      maxD = d;
      maxI = i;
    }
  }
  if (maxD <= eps) return [first, last];
  const left = simplifyRdp(points.slice(0, maxI + 1), eps);
  const right = simplifyRdp(points.slice(maxI), eps);
  return left.slice(0, -1).concat(right);
}

/** Keep wall jogs; drop raster stair-steps. */
function simplifyClosed(points: Pt[], eps: number): Pt[] {
  if (points.length < 4) return points;
  const a0 = points[0];
  const aN = points[points.length - 1];
  const ring = a0.x === aN.x && a0.y === aN.y ? points.slice(0, -1) : points;
  const simplified = simplifyRdp([...ring, ring[0]], eps);
  if (simplified.length >= 2) {
    const a = simplified[0];
    const b = simplified[simplified.length - 1];
    if (a.x === b.x && a.y === b.y) simplified.pop();
  }
  return simplified.length >= 3 ? simplified : ring;
}

/** Outer crack-code contour of cells with `id` (cell-corner coords). */
function traceOccupiedContour(
  grid: Int16Array,
  gw: number,
  gh: number,
  id: number,
): { x: number; y: number }[] {
  const occupied = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < gw && y < gh && grid[y * gw + x] === id;
  const key = (x: number, y: number) => `${x},${y}`;
  const outgoing = new Map<string, { x: number; y: number }[]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = key(x0, y0);
    const list = outgoing.get(k) ?? [];
    list.push({ x: x1, y: y1 });
    outgoing.set(k, list);
  };
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!occupied(x, y)) continue;
      if (!occupied(x, y - 1)) add(x, y, x + 1, y);
      if (!occupied(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!occupied(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!occupied(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  if (!outgoing.size) return [];
  let startX = Infinity;
  let startY = Infinity;
  for (const k of outgoing.keys()) {
    const [xs, ys] = k.split(",").map(Number);
    if (ys < startY || (ys === startY && xs < startX)) {
      startX = xs;
      startY = ys;
    }
  }
  const path: { x: number; y: number }[] = [{ x: startX, y: startY }];
  let cx = startX;
  let cy = startY;
  const used = new Set<string>();
  for (let guard = 0; guard < gw * gh * 8; guard++) {
    const opts = outgoing.get(key(cx, cy)) ?? [];
    let next: { x: number; y: number } | undefined;
    for (const n of opts) {
      const ek = `${cx},${cy}->${n.x},${n.y}`;
      if (used.has(ek)) continue;
      used.add(ek);
      next = n;
      break;
    }
    if (!next) break;
    cx = next.x;
    cy = next.y;
    if (cx === startX && cy === startY) break;
    path.push({ x: cx, y: cy });
  }
  return path;
}

function wallEnvelope(walls: IndexedShape[]): Pt[] | null {
  const external = walls.filter((w) => isExternalWallLabel(w.label));
  const source = external.length ? external : walls;
  const pts = source.flatMap((w) => w.points);
  const hull = convexHull(pts);
  if (hull.length < 3) return null;
  const box = bboxOf(hull);
  if (!box) return null;
  const minSpan = Math.min(box.x1 - box.x0, box.y1 - box.y0);
  if (minSpan < 8) return null;
  return hull;
}

function intersectConvex(a: Pt[], b: Pt[] | null): Pt[] {
  if (!b || b.length < 3) return a;
  if (a.length < 3) return b;
  const pts: Pt[] = [];
  for (const p of a) {
    if (pointInPoly(p.x, p.y, b)) pts.push(p);
  }
  for (const p of b) {
    if (pointInPoly(p.x, p.y, a)) pts.push(p);
  }
  const hull = convexHull(pts);
  return hull.length >= 3 ? hull : a;
}

function stampLine(
  grid: Int16Array,
  gw: number,
  gh: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius = 1,
): void {
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  const r = Math.max(1, radius);
  while (true) {
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx >= 0 && ny >= 0 && nx < gw && ny < gh) grid[ny * gw + nx] = -1;
      }
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function wallStampRadius(wall: IndexedShape, gw: number, gh: number, widthPx: number, heightPx: number): number {
  const gridMin = Math.min(gw, gh);
  const base = isExternalWallLabel(wall.label) ? 0.018 : 0.012;
  if (isEnvelopeOutlineWall(wall, widthPx, heightPx)) {
    return Math.max(1, Math.round(gridMin * base));
  }
  const box = wall.box;
  const thin = Math.min(box.x1 - box.x0, box.y1 - box.y0);
  const pageMax = Math.max(widthPx, heightPx);
  if (thin > 2 && thin < pageMax * 0.08) {
    return Math.max(2, Math.round((thin / pageMax) * gridMin * 0.55));
  }
  return Math.max(1, Math.round(gridMin * base));
}

function stampClosedPoly(
  grid: Int16Array,
  gw: number,
  gh: number,
  widthPx: number,
  heightPx: number,
  pts: Pt[],
): void {
  const box = bboxOf(pts);
  if (!box || pts.length < 3) return;
  const x0 = Math.max(0, Math.round((box.x0 / widthPx) * (gw - 1)));
  const y0 = Math.max(0, Math.round((box.y0 / heightPx) * (gh - 1)));
  const x1 = Math.min(gw - 1, Math.round((box.x1 / widthPx) * (gw - 1)));
  const y1 = Math.min(gh - 1, Math.round((box.y1 / heightPx) * (gh - 1)));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = (x / (gw - 1)) * widthPx;
      const py = (y / (gh - 1)) * heightPx;
      if (pointInPoly(px, py, pts)) grid[y * gw + x] = -1;
    }
  }
}

type FloodGrid = {
  grid: Int16Array;
  gw: number;
  gh: number;
  toCell: (p: Pt) => { x: number; y: number };
  cornerToPage: (x: number, y: number) => Pt;
};

function makeFloodGrid(
  walls: IndexedShape[],
  widthPx: number,
  heightPx: number,
  clipPolys?: (Pt[] | null | undefined)[],
  doorGaps: Pt[] = [],
  extraBarrierPolys: Pt[][] = [],
): FloodGrid | null {
  if (widthPx < 2 || heightPx < 2) return null;
  const maxSide = 240;
  const scale = Math.min(maxSide / widthPx, maxSide / heightPx, 1);
  const gw = Math.max(8, Math.round(widthPx * scale));
  const gh = Math.max(8, Math.round(heightPx * scale));
  const grid = new Int16Array(gw * gh);

  const toCell = (p: Pt) => ({
    x: Math.max(0, Math.min(gw - 1, Math.round((p.x / widthPx) * (gw - 1)))),
    y: Math.max(0, Math.min(gh - 1, Math.round((p.y / heightPx) * (gh - 1)))),
  });
  const cornerToPage = (x: number, y: number): Pt => ({
    x: (x / gw) * widthPx,
    y: (y / gh) * heightPx,
  });

  const clips = (clipPolys ?? []).filter((poly): poly is Pt[] => Boolean(poly && poly.length >= 3));
  if (clips.length) {
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const px = (x / (gw - 1)) * widthPx;
        const py = (y / (gh - 1)) * heightPx;
        if (clips.some((poly) => !pointInPoly(px, py, poly))) grid[y * gw + x] = -1;
      }
    }
  }

  for (const wall of walls) {
    const pts = wall.points;
    const closed =
      wall.entity.geometry.kind === "polygon" ||
      wall.entity.geometry.kind === "rect" ||
      wall.entity.geometry.kind === "mask";
    if (closed && pts.length >= 3 && !isEnvelopeOutlineWall(wall, widthPx, heightPx)) {
      stampClosedPoly(grid, gw, gh, widthPx, heightPx, pts);
      continue;
    }
    const lineR = wallStampRadius(wall, gw, gh, widthPx, heightPx);
    for (let i = 0; i < pts.length - (wall.entity.geometry.kind === "polyline" ? 1 : 0); i++) {
      const a = toCell(pts[i]);
      const b = toCell(pts[(i + 1) % pts.length]);
      if (wall.entity.geometry.kind === "polyline" && i === pts.length - 1) break;
      stampLine(grid, gw, gh, a.x, a.y, b.x, b.y, lineR);
    }
  }

  for (const poly of extraBarrierPolys) {
    stampClosedPoly(grid, gw, gh, widthPx, heightPx, poly);
  }

  const gapR = Math.max(1, Math.round(Math.min(gw, gh) * 0.012));
  for (const gap of doorGaps) {
    const c = toCell(gap);
    for (let y = c.y - gapR; y <= c.y + gapR; y++) {
      for (let x = c.x - gapR; x <= c.x + gapR; x++) {
        if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
        if (grid[y * gw + x] === -1) grid[y * gw + x] = 0;
      }
    }
  }

  // Door gaps must not punch through communal / extra barriers.
  for (const poly of extraBarrierPolys) {
    stampClosedPoly(grid, gw, gh, widthPx, heightPx, poly);
  }

  return { grid, gw, gh, toCell, cornerToPage };
}

const FLOOD_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function tryOpenCell(
  grid: Int16Array,
  gw: number,
  gh: number,
  toCell: (p: Pt) => { x: number; y: number },
  start: Pt,
): { x: number; y: number } | null {
  const c = toCell(start);
  const tryCells = [c, { x: c.x + 1, y: c.y }, { x: c.x - 1, y: c.y }, { x: c.x, y: c.y + 1 }, { x: c.x, y: c.y - 1 }];
  for (const cell of tryCells) {
    if (cell.x < 0 || cell.y < 0 || cell.x >= gw || cell.y >= gh) continue;
    if (grid[cell.y * gw + cell.x] === -1) continue;
    return cell;
  }
  return null;
}

function contourForId(
  grid: Int16Array,
  gw: number,
  gh: number,
  id: number,
  widthPx: number,
  heightPx: number,
  cornerToPage: (x: number, y: number) => Pt,
): Pt[] | null {
  let claimed = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === id) claimed++;
  }
  if (claimed < 4) return null;
  const corners = traceOccupiedContour(grid, gw, gh, id);
  if (corners.length < 3) return null;
  const eps = Math.max(3, Math.min(widthPx, heightPx) * 0.006);
  const points = simplifyClosed(
    corners.map((c) => cornerToPage(c.x, c.y)),
    eps,
  );
  return points.length >= 3 ? points : null;
}

type FloodSeedGroup = { unitId: string; starts: Pt[] };

function floodFillFromSeeds(
  seedGroups: FloodSeedGroup[],
  walls: IndexedShape[],
  widthPx: number,
  heightPx: number,
  clipPolys?: (Pt[] | null | undefined)[],
  doorGaps: Pt[] = [],
  extraBarrierPolys: Pt[][] = [],
): { unitId: string; points: Pt[] }[] {
  if (!seedGroups.length) return [];
  const ctx = makeFloodGrid(walls, widthPx, heightPx, clipPolys, doorGaps, extraBarrierPolys);
  if (!ctx) return [];
  const { grid, gw, gh, toCell, cornerToPage } = ctx;

  type SeedCell = { id: number; unitId: string; x: number; y: number };
  const seedCells: SeedCell[] = [];
  seedGroups.forEach((group, idx) => {
    const id = idx + 1;
    let planted = false;
    for (const start of group.starts) {
      const c = toCell(start);
      const tryCells = [
        c,
        { x: c.x + 1, y: c.y },
        { x: c.x - 1, y: c.y },
        { x: c.x, y: c.y + 1 },
        { x: c.x, y: c.y - 1 },
      ];
      const open = tryCells.find(
        (cell) =>
          cell.x >= 0 &&
          cell.y >= 0 &&
          cell.x < gw &&
          cell.y < gh &&
          grid[cell.y * gw + cell.x] !== -1 &&
          grid[cell.y * gw + cell.x] !== id,
      );
      if (!open) continue;
      if (grid[open.y * gw + open.x] !== 0 && grid[open.y * gw + open.x] !== id) continue;
      grid[open.y * gw + open.x] = id;
      seedCells.push({ id, unitId: group.unitId, x: open.x, y: open.y });
      planted = true;
    }
    if (!planted) return;
  });
  if (!seedCells.length) return [];

  const queue = seedCells.map((s) => ({ x: s.x, y: s.y, id: s.id }));
  let qh = 0;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  while (qh < queue.length) {
    const cur = queue[qh++];
    for (const [dx, dy] of dirs) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
      const i = ny * gw + nx;
      if (grid[i] !== 0) continue;
      grid[i] = cur.id;
      queue.push({ x: nx, y: ny, id: cur.id });
    }
  }

  const totalOpen = grid.reduce((n, v) => n + (v !== -1 ? 1 : 0), 0);
  const seenIds = new Set<number>();
  const out: { unitId: string; points: Pt[] }[] = [];
  const eps = Math.max(3, Math.min(widthPx, heightPx) * 0.006);
  for (const seed of seedCells) {
    if (seenIds.has(seed.id)) continue;
    seenIds.add(seed.id);
    let claimed = 0;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === seed.id) claimed++;
    }
    if (claimed < 4) continue;
    if (totalOpen > 0 && claimed / totalOpen > 0.7 && seedGroups.length > 1) continue;
    const corners = traceOccupiedContour(grid, gw, gh, seed.id);
    if (corners.length < 3) continue;
    const points = simplifyClosed(
      corners.map((c) => cornerToPage(c.x, c.y)),
      eps,
    );
    if (points.length < 3) continue;
    out.push({ unitId: seed.unitId, points });
  }
  return out;
}

function extractOpenPockets(
  walls: IndexedShape[],
  extraBarrierPolys: Pt[][],
  widthPx: number,
  heightPx: number,
  clipPolys?: (Pt[] | null | undefined)[],
): Pt[][] {
  const ctx = makeFloodGrid(walls, widthPx, heightPx, clipPolys, [], extraBarrierPolys);
  if (!ctx) return [];
  const { grid, gw, gh, cornerToPage } = ctx;
  let nextId = 1;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (grid[y * gw + x] !== 0) continue;
      const id = nextId++;
      const queue = [{ x, y }];
      grid[y * gw + x] = id;
      let qh = 0;
      while (qh < queue.length) {
        const cur = queue[qh++];
        for (const [dx, dy] of FLOOD_DIRS) {
          const nx = cur.x + dx;
          const ny = cur.y + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const i = ny * gw + nx;
          if (grid[i] !== 0) continue;
          grid[i] = id;
          queue.push({ x: nx, y: ny });
        }
      }
    }
  }

  const totalOpen = grid.reduce((n, v) => n + (v !== -1 ? 1 : 0), 0);
  const out: Pt[][] = [];
  for (let id = 1; id < nextId; id++) {
    let claimed = 0;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === id) claimed++;
    }
    if (claimed < 8) continue;
    if (totalOpen > 0 && claimed / totalOpen > 0.7 && nextId > 2) continue;
    const points = contourForId(grid, gw, gh, id, widthPx, heightPx, cornerToPage);
    if (points) out.push(points);
  }
  return out;
}

function groupRoomsByCommunalResidual(
  remainingRooms: IndexedShape[],
  walls: IndexedShape[],
  communalPolys: Pt[][],
  widthPx: number,
  heightPx: number,
  clipPolys: (Pt[] | null | undefined)[],
  internalDoorGaps: Pt[],
): { rooms: IndexedShape[]; points: Pt[] }[] {
  if (!remainingRooms.length) return [];
  const ctx = makeFloodGrid(walls, widthPx, heightPx, clipPolys, internalDoorGaps, communalPolys);
  if (!ctx) return [];
  const { grid, gw, gh, toCell, cornerToPage } = ctx;

  const idToRooms = new Map<number, IndexedShape[]>();
  const seedCells: { id: number; x: number; y: number }[] = [];
  let nextId = 1;

  for (const room of remainingRooms) {
    const cell = tryOpenCell(grid, gw, gh, toCell, room.centroid);
    if (!cell) continue;
    const existing = grid[cell.y * gw + cell.x];
    if (existing > 0) {
      const list = idToRooms.get(existing) ?? [];
      list.push(room);
      idToRooms.set(existing, list);
      continue;
    }
    const id = nextId++;
    grid[cell.y * gw + cell.x] = id;
    seedCells.push({ id, x: cell.x, y: cell.y });
    idToRooms.set(id, [room]);
  }
  if (!seedCells.length) return [];

  const queue = seedCells.map((s) => ({ x: s.x, y: s.y, id: s.id }));
  let qh = 0;
  while (qh < queue.length) {
    const cur = queue[qh++];
    for (const [dx, dy] of FLOOD_DIRS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
      const i = ny * gw + nx;
      if (grid[i] !== 0) continue;
      grid[i] = cur.id;
      queue.push({ x: nx, y: ny, id: cur.id });
    }
  }

  const totalOpen = grid.reduce((n, v) => n + (v !== -1 ? 1 : 0), 0);
  const out: { rooms: IndexedShape[]; points: Pt[] }[] = [];
  for (const seed of seedCells) {
    const rooms = idToRooms.get(seed.id) ?? [];
    if (!rooms.length) continue;
    let claimed = 0;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] === seed.id) claimed++;
    }
    if (claimed < 4) continue;
    if (totalOpen > 0 && claimed / totalOpen > 0.85) continue;
    const points = contourForId(grid, gw, gh, seed.id, widthPx, heightPx, cornerToPage);
    if (!points) continue;
    out.push({ rooms, points });
  }
  return out;
}

function centroidInAnyUnit(pt: Pt, units: { points: Pt[] }[]): boolean {
  return units.some((u) => u.points.length >= 3 && pointInPoly(pt.x, pt.y, u.points));
}

function toOverlayEntity(unit: InferredUnitBoundary): OverlayEntity {
  const now = new Date().toISOString();
  return {
    id: unit.id,
    type: "unit_boundary",
    layer: ENTITY_LAYER.unit_boundary,
    geometry: { kind: "polygon", points: unit.points },
    label: unit.label,
    confidence: unit.confidence,
    status: "predicted",
    source: "inferred",
    attributes: {
      label: unit.label,
      ocrUnitId: unit.unitId,
      inferred: true,
      method: unit.method,
      reviewRequired: unit.reviewRequired,
      roomIds: unit.roomIds,
      entranceIds: unit.entranceIds,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function makeUnitId(pageNumber: number | undefined, unitId: string, cx: number, cy: number): string {
  const safe = unitId.replace(/[^A-Za-z0-9]+/g, "-") || "unit";
  const page = pageNumber ?? 0;
  return `inferred-unit-${page}-${safe}-${Math.round(cx)}-${Math.round(cy)}`;
}

/**
 * Infer `unit_boundary` polygons. First hit wins per unit number:
 * 1. Keep YOLO Unit polygons and attach nearest drawing-OCR label.
 * 2. Flood lift lobby / corridor; classify unit entrances as wide doors on that spine;
 *    flood-fill each apartment from main-door seeds (walls + windows block, internal doors open gaps).
 * 3. Else cluster private room overlays by internal-door graph, clipped to the wall envelope.
 * 4. Else grow communal residual pockets and leftover wall regions.
 * 5. Else when OCR unit names exist, flood-fill from unit-id OCR using structural walls.
 */
export function inferUnitBoundaries(input: InferUnitBoundariesInput): InferUnitBoundariesResult {
  const { entities, drawingOcrMeta, widthPx, heightPx, pageNumber, mainDoorWidth } = input;
  const live = entities.filter((e) => !isRejected(e));
  const drawingArea = live.find((e) => e.type === "main_floorplan");
  const titleBlock = live.find((e) => e.type === "title_block");
  const ocrSeeds = extractDrawingUnitLabels(drawingOcrMeta?.lines, {
    drawingArea: drawingArea ? entityPoints(drawingArea) : null,
    titleBlock: titleBlock ? entityPoints(titleBlock) : null,
  });
  const boundaryHead = resolveUnitBoundaryHeadMode({ ocrUnitSeedCount: ocrSeeds.length });
  const barrier = barrierEntitiesForUnitInference(live);
  const wallEntityPool =
    boundaryHead === "structural_named" && barrier.walls.length ? barrier.walls : live;
  const doorEntityPool =
    boundaryHead === "structural_named" && barrier.doors.length ? barrier.doors : live;

  const yoloUnits = live.filter(isYoloUnit).map((entity) => {
    const points = entityPoints(entity);
    const centroid = centroidOf(points);
    return { entity, points, centroid: centroid ?? { x: 0, y: 0 } };
  }).filter((u) => u.points.length >= 3);

  const rooms = indexShapes(live, "room");
  const doors = indexShapes(doorEntityPool, "door");
  const walls = [...indexShapes(wallEntityPool, "wall")];
  const windows = indexShapes(live, "window");
  const floodBarriers = [...walls, ...windows];
  const envelope = wallEnvelope(walls);
  const pad = Math.max(24, Math.min(widthPx, heightPx) * 0.015);
  const doorLikes = doors.map((d) => ({
    id: d.entity.id,
    label: d.label,
    centroid: d.centroid,
    spanPx: doorOpeningSpanFromPoints(d.points),
  }));

  const communalOcrSeeds = extractCommunalOcrSeeds(drawingOcrMeta?.lines, {
    drawingArea: drawingArea ? entityPoints(drawingArea) : null,
    titleBlock: titleBlock ? entityPoints(titleBlock) : null,
  });
  const commonRoomStarts = rooms.filter((r) => isCommonRoomLabel(r.label)).map((r) => r.centroid);
  const communalStarts = buildCommunalSeedPoints({
    ocrCentroids: communalOcrSeeds.map((s) => s.centroid),
    commonRoomCentroids: commonRoomStarts,
    doors: doorLikes,
    padPx: pad,
    mainDoorWidth,
  });
  const clipPolys = [drawingArea ? entityPoints(drawingArea) : null, envelope];

  let communalPolys: Pt[][] = [];
  let mainDoorIds = new Set<string>();
  if (floodBarriers.length && communalStarts.length) {
    const privateRoomBarriers = rooms
      .filter((r) => !isCommonRoomLabel(r.label))
      .map((r) => r.points)
      .filter((p) => p.length >= 3);
    const communalFilled = floodFillFromSeeds(
      communalStarts.map((start, i) => ({ unitId: `__communal_${i}`, starts: [start] })),
      floodBarriers,
      widthPx,
      heightPx,
      clipPolys,
      [],
      privateRoomBarriers,
    );
    communalPolys = communalFilled
      .map((region) => region.points)
      .filter(
        (poly) =>
          poly.length >= 3 &&
          !rooms
            .filter((r) => !isCommonRoomLabel(r.label))
            .some((r) => pointInPoly(r.centroid.x, r.centroid.y, poly)),
      );
    if (doors.length && communalPolys.length) {
      mainDoorIds = classifyUnitEntranceDoors(doorLikes, communalPolys, pad, mainDoorWidth);
    }
  }

  const doorIsMain = (door: IndexedShape) => isMainDoorLabel(door.label) || mainDoorIds.has(door.entity.id);
  const doorIsInternal = (door: IndexedShape) => !doorIsMain(door);

  const yoloLabelPatches: YoloLabelPatch[] = [];
  const keptYolo: InferredUnitBoundary[] = [];
  const usedUnitIds = new Set<string>();

  if (yoloUnits.length) {
    const labeled = assignLabelsGreedy(yoloUnits, ocrSeeds);
    yoloUnits.forEach((unit, i) => {
      const seed = labeled.get(i);
      const existingToken = parseUnitTokenFromLine(attrLabel(unit.entity));
      const unitId = seed?.unitId ?? existingToken ?? `U${i + 1}`;
      const label = seed ? unitLabelForSeed(seed) : formatUnitLabel(unitId);
      usedUnitIds.add(unitId);
      if (seed || (existingToken && existingToken !== attrLabel(unit.entity))) {
        yoloLabelPatches.push({
          id: unit.entity.id,
          label,
          attributes: {
            ocrUnitId: unitId,
            method: "yolo",
            room_label_assignment: unitId,
          },
        });
      }
      keptYolo.push({
        id: unit.entity.id,
        label,
        unitId,
        points: unit.points,
        method: "yolo",
        reviewRequired: false,
        roomIds: rooms
          .filter((r) => !isCommonRoomLabel(r.label) && pointInPoly(r.centroid.x, r.centroid.y, unit.points))
          .map((r) => r.entity.id),
        entranceIds: doors
          .filter((d) => doorIsMain(d) && pointInBox(d.centroid.x, d.centroid.y, expandBox(bboxOf(unit.points)!, pad)))
          .map((d) => d.entity.id),
        confidence: unit.entity.confidence ?? 0.8,
      });
    });
  }

  const remainingSeeds = ocrSeeds.filter((s) => !usedUnitIds.has(s.unitId));
  const remainingRooms = rooms.filter(
    (r) => !isCommonRoomLabel(r.label) && !centroidInAnyUnit(r.centroid, keptYolo),
  );
  const created: InferredUnitBoundary[] = [];
  const linkDist2 = apartmentLinkDist2(widthPx, heightPx, pad);

  const pushCreated = (
    unit: Omit<InferredUnitBoundary, "id" | "label"> & { unitId: string },
    seed?: OcrSeed | null,
  ) => {
    const c = centroidOf(unit.points) ?? unit.points[0];
    if (centroidInAnyUnit(c, [...keptYolo, ...created])) return;

    const existingSame = created.find((u) => u.unitId === unit.unitId);
    if (existingSame) {
      mergeUnitGeometry(existingSame, unit);
      return;
    }

    const label = seed ? unitLabelForSeed(seed) : formatUnitLabel(unit.unitId);
    usedUnitIds.add(unit.unitId);
    created.push({
      ...unit,
      id: makeUnitId(pageNumber, unit.unitId, c.x, c.y),
      label,
    });
  };

  if (floodBarriers.length && communalPolys.length && doors.length && mainDoorIds.size > 0) {
    const communalCentroid = communalRegionCentroid(communalPolys);
    const internalGaps = doors.filter((d) => doorIsInternal(d)).map((d) => d.centroid);
    const seedGroups: FloodSeedGroup[] = [];
    const seenSeedKeys = new Set<string>();

    for (const door of doors.filter((d) => doorIsMain(d))) {
      const start = unitSeedBehindMainDoor(door.centroid, communalCentroid, Math.max(pad * 0.75, 12));
      const key = `${Math.round(start.x / 6)}:${Math.round(start.y / 6)}`;
      if (seenSeedKeys.has(key)) continue;
      seenSeedKeys.add(key);
      seedGroups.push({ unitId: `__maindoor_${door.entity.id}`, starts: [start] });
    }

    for (const seed of ocrSeeds) {
      if (usedUnitIds.has(seed.unitId)) continue;
      if (communalPolys.some((poly) => pointInPoly(seed.centroid.x, seed.centroid.y, poly))) continue;
      const nearMainDoor = seedGroups.some((g) =>
        g.starts.some((s) => dist2(s, seed.centroid) <= pad * pad * 16),
      );
      if (nearMainDoor) continue;
      seedGroups.push({ unitId: seed.unitId, starts: [seed.centroid] });
    }

    if (seedGroups.length) {
      const filled = floodFillFromSeeds(
        seedGroups,
        floodBarriers,
        widthPx,
        heightPx,
        clipPolys,
        internalGaps,
        communalPolys,
      );
      const assigned = assignNearestSeeds(
        filled.map((region) => ({ centroid: centroidOf(region.points) ?? region.points[0] })),
        ocrSeeds,
        ocrSeeds.length ? linkDist2 : undefined,
      );
      filled.forEach((region, i) => {
        const c = centroidOf(region.points) ?? region.points[0];
        if (centroidInAnyUnit(c, [...keptYolo, ...created])) return;

        const roomIds = rooms
          .filter(
            (r) =>
              !isCommonRoomLabel(r.label) &&
              pointInPoly(r.centroid.x, r.centroid.y, region.points) &&
              !centroidInAnyUnit(r.centroid, keptYolo),
          )
          .map((r) => r.entity.id);
        const entranceIds = doors
          .filter(
            (d) =>
              doorIsMain(d) &&
              (pointInPoly(d.centroid.x, d.centroid.y, region.points) ||
                minDistToPolygon(d.centroid, region.points) <= pad),
          )
          .map((d) => d.entity.id);
        const orphanPayload = { points: region.points, entranceIds, roomIds };

        let seed = assigned.get(i) ?? null;
        let unitId = seed?.unitId;
        if (!unitId) {
          if (region.unitId.startsWith("__maindoor_") || region.unitId.startsWith("__")) {
            if (ocrSeeds.length) {
              seed = nearestOcrSeed(c, ocrSeeds);
              unitId = seed?.unitId;
            }
            if (!unitId) {
              if (
                absorbOrphanRegion(orphanPayload, c, [...keptYolo, ...created], ocrSeeds, linkDist2)
              ) {
                return;
              }
              if (!ocrSeeds.length) {
                unitId = nextAnonymousUnitId([...keptYolo, ...created]);
              } else {
                return;
              }
            }
          } else if (!region.unitId.startsWith("__")) {
            unitId = region.unitId;
          } else {
            return;
          }
        }

        pushCreated(
          {
            unitId,
            points: region.points,
            method: "communal_main_door",
            reviewRequired: !seed,
            roomIds,
            entranceIds,
            confidence: seed ? 0.78 : 0.58,
          },
          seed ?? ocrSeeds.find((s) => s.unitId === unitId),
        );
      });
    }
  }

  const openRemainingRooms = remainingRooms.filter(
    (r) => !centroidInAnyUnit(r.centroid, [...keptYolo, ...created]),
  );

  if (openRemainingRooms.length && doors.length) {
    const remIndexes = new Set(openRemainingRooms.map((r) => rooms.indexOf(r)));
    const clusters = clusterPrivateRoomsByDoors(rooms, doors, pad, doorIsMain)
      .map((c) => ({ ...c, roomIndexes: c.roomIndexes.filter((i) => remIndexes.has(i)) }))
      .filter((c) => c.roomIndexes.length);
    const doorGaps = doors.filter((d) => doorIsInternal(d)).map((d) => d.centroid);
    const clip = clipPolys;

    if (floodBarriers.length) {
      const filled = floodFillFromSeeds(
        clusters.map((c, i) => ({
          unitId: `__cluster_${i}`,
          starts: c.roomIndexes.map((idx) => rooms[idx].centroid),
        })),
        floodBarriers,
        widthPx,
        heightPx,
        clip,
        doorGaps,
      );
      const assigned = assignNearestSeeds(
        filled.map((region) => ({ centroid: centroidOf(region.points) ?? region.points[0] })),
        ocrSeeds,
        ocrSeeds.length ? linkDist2 : undefined,
      );
      filled.forEach((region, i) => {
        const clusterIdx = Number(String(region.unitId).replace(/^__cluster_/, ""));
        const cluster = Number.isFinite(clusterIdx) ? clusters[clusterIdx] : undefined;
        const c = centroidOf(region.points) ?? region.points[0];
        const payload = {
          points: region.points,
          entranceIds: cluster?.entranceIds ?? [],
          roomIds: cluster?.roomIndexes.map((idx) => rooms[idx].entity.id) ?? [],
        };
        const resolved = resolveUnitFromRegion(
          c,
          payload,
          [...keptYolo, ...created],
          ocrSeeds,
          linkDist2,
          assigned.get(i),
        );
        if (!resolved) return;
        pushCreated(
          {
            unitId: resolved.unitId,
            points: region.points,
            method: "wall_flood_fill",
            reviewRequired: !resolved.seed,
            roomIds: payload.roomIds,
            entranceIds: payload.entranceIds,
            confidence: resolved.seed ? 0.72 : 0.5,
          },
          resolved.seed,
        );
      });
    } else {
      const clusterShapes = clusters
        .map((c) => {
          const pts = hullFromRooms(rooms, c.roomIndexes);
          return {
            cluster: c,
            points: pts,
            centroid: centroidOf(pts) ?? { x: 0, y: 0 },
          };
        })
        .filter((c) => c.points.length >= 3 && !centroidInAnyUnit(c.centroid, keptYolo));
      const assigned = assignNearestSeeds(clusterShapes, ocrSeeds, ocrSeeds.length ? linkDist2 : undefined);
      clusterShapes.forEach((shape, i) => {
        const roomIds = shape.cluster.roomIndexes.map((idx) => rooms[idx].entity.id);
        if (!roomIds.length) return;
        const payload = {
          points: shape.points,
          entranceIds: shape.cluster.entranceIds,
          roomIds,
        };
        const resolved = resolveUnitFromRegion(
          shape.centroid,
          payload,
          [...keptYolo, ...created],
          ocrSeeds,
          linkDist2,
          assigned.get(i),
        );
        if (!resolved) return;
        pushCreated(
          {
            unitId: resolved.unitId,
            points: shape.points,
            method: "room_door_cluster",
            reviewRequired: !resolved.seed,
            roomIds,
            entranceIds: shape.cluster.entranceIds,
            confidence: resolved.seed ? 0.7 : 0.55,
          },
          resolved.seed,
        );
      });
    }
  }

  const stillRemainingRooms = rooms.filter(
    (r) =>
      !isCommonRoomLabel(r.label) &&
      !centroidInAnyUnit(r.centroid, [...keptYolo, ...created]),
  );

  if (floodBarriers.length && communalStarts.length && (stillRemainingRooms.length || rooms.every((r) => isCommonRoomLabel(r.label)))) {
    const clip = clipPolys;
    const privateRoomBarriers = stillRemainingRooms.map((r) => r.points).filter((p) => p.length >= 3);
    if (!communalPolys.length) {
      const communalFilled = floodFillFromSeeds(
        communalStarts.map((start, i) => ({ unitId: `__communal_${i}`, starts: [start] })),
        floodBarriers,
        widthPx,
        heightPx,
        clip,
        [],
        privateRoomBarriers,
      );
      communalPolys = communalFilled
        .map((region) => region.points)
        .filter(
          (poly) =>
            poly.length >= 3 &&
            !stillRemainingRooms.some((r) => pointInPoly(r.centroid.x, r.centroid.y, poly)),
        );
      if (doors.length && communalPolys.length && !mainDoorIds.size) {
        mainDoorIds = classifyUnitEntranceDoors(doorLikes, communalPolys, pad, mainDoorWidth);
      }
    }

    if (communalPolys.length) {
      const internalDoorGaps = doors.filter((d) => doorIsInternal(d)).map((d) => d.centroid);

      if (stillRemainingRooms.length) {
        const grouped = groupRoomsByCommunalResidual(
          stillRemainingRooms,
          floodBarriers,
          communalPolys,
          widthPx,
          heightPx,
          clip,
          internalDoorGaps,
        );
        const assigned = assignNearestSeeds(
          grouped.map((g) => ({ centroid: centroidOf(g.points) ?? g.points[0] })),
          ocrSeeds,
          ocrSeeds.length ? linkDist2 : undefined,
        );
        grouped.forEach((group, i) => {
          const c = centroidOf(group.points) ?? group.points[0];
          const entranceIds = doors
            .filter(
              (d) =>
                doorIsMain(d) &&
                (pointInPoly(d.centroid.x, d.centroid.y, group.points) ||
                  group.rooms.some((r) => pointInBox(d.centroid.x, d.centroid.y, expandBox(r.box, pad)))),
            )
            .map((d) => d.entity.id);
          const payload = {
            points: group.points,
            entranceIds,
            roomIds: group.rooms.map((r) => r.entity.id),
          };
          const resolved = resolveUnitFromRegion(
            c,
            payload,
            [...keptYolo, ...created],
            ocrSeeds,
            linkDist2,
            assigned.get(i),
          );
          if (!resolved) return;
          pushCreated(
            {
              unitId: resolved.unitId,
              points: group.points,
              method: "communal_residual",
              reviewRequired: !resolved.seed,
              roomIds: payload.roomIds,
              entranceIds,
              confidence: resolved.seed ? 0.62 : 0.48,
            },
            resolved.seed,
          );
        });
      } else if (!rooms.some((r) => !isCommonRoomLabel(r.label))) {
        const pockets = extractOpenPockets(floodBarriers, communalPolys, widthPx, heightPx, clip).filter(
          (poly) => !communalPolys.some((c) => pointInPoly((centroidOf(poly) ?? poly[0]).x, (centroidOf(poly) ?? poly[0]).y, c)),
        );
        const assigned = assignNearestSeeds(
          pockets.map((points) => ({ centroid: centroidOf(points) ?? points[0] })),
          ocrSeeds,
          ocrSeeds.length ? linkDist2 : undefined,
        );
        pockets.forEach((points, i) => {
          const c = centroidOf(points) ?? points[0];
          const entranceIds = doors
            .filter((d) => doorIsMain(d) && pointInPoly(d.centroid.x, d.centroid.y, points))
            .map((d) => d.entity.id);
          const payload = { points, entranceIds, roomIds: [] as string[] };
          const resolved = resolveUnitFromRegion(
            c,
            payload,
            [...keptYolo, ...created],
            ocrSeeds,
            linkDist2,
            assigned.get(i),
          );
          if (!resolved) return;
          pushCreated(
            {
              unitId: resolved.unitId,
              points,
              method: "communal_residual",
              reviewRequired: !resolved.seed,
              roomIds: [],
              entranceIds,
              confidence: resolved.seed ? 0.5 : 0.4,
            },
            resolved.seed,
          );
        });
      }
    }
  }

  const leftoverSeeds = ocrSeeds.filter((s) => !usedUnitIds.has(s.unitId));
  if (leftoverSeeds.length && floodBarriers.length && boundaryHead === "structural_named") {
    const filled = floodFillFromSeeds(
      leftoverSeeds.map((s) => ({ unitId: s.unitId, starts: [s.centroid] })),
      floodBarriers,
      widthPx,
      heightPx,
      [drawingArea ? entityPoints(drawingArea) : null, envelope],
    );
    for (const region of filled) {
      const seed = leftoverSeeds.find((s) => s.unitId === region.unitId);
      pushCreated(
        {
          unitId: region.unitId,
          points: region.points,
          method: "wall_flood_fill",
          reviewRequired: true,
          roomIds: remainingRooms
            .filter((r) => pointInPoly(r.centroid.x, r.centroid.y, region.points))
            .map((r) => r.entity.id),
          entranceIds: doors
            .filter((d) => doorIsMain(d) && pointInPoly(d.centroid.x, d.centroid.y, region.points))
            .map((d) => d.entity.id),
          confidence: 0.45,
        },
        seed,
      );
    }
  }

  const units = [...keptYolo, ...created];
  return {
    units,
    createdEntities: created.map(toOverlayEntity),
    yoloLabelPatches,
  };
}
