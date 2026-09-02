import { overlayGeometryPoints, pointInPolygon } from "@/features/plan-editor/geometry";
import { isRoomOverlayEntity, isUnitOutlineEntity, isWallOverlayEntity } from "@/features/plan-editor/labelClasses";
import { ENTITY_LAYER, type OverlayEntity, type OverlayGeometry } from "@/features/plan-editor/types";
import { adjacencyPadPx } from "@/lib/hierarchy/roomProperties";
import { areaM2FromPx, polygonAreaPx2 } from "@/lib/hierarchy/apartmentCharacteristics";
import { isCommonRoomLabel } from "@/lib/hierarchy/inferUnitBoundaries";
import {
  classifyMainDoorsByWidth,
  isExplicitMainDoorLabel,
  unitSeedBehindMainDoor,
  type MainDoorWidthOpts,
} from "@/lib/hierarchy/communalMainDoor";
import { doorLikesFromEntities } from "@/lib/hierarchy/doorLikesFromEntities";

export type Pt = { x: number; y: number };

export type GeometryInputEntity = {
  id: string;
  type: string;
  label: string;
  geometry: OverlayGeometry;
  status?: string;
  source?: string;
};

export type ExtractedGeometryRoom = {
  id: string;
  label: string;
  unitId: string | null;
  unitLabel: string | null;
  isCommon: boolean;
  points: Pt[];
  areaPx2: number;
  widthPx: number;
  depthPx: number;
  perimeterPx: number;
  areaM2: number | null;
  widthM: number | null;
  depthM: number | null;
  perimeterM: number | null;
  /** Printed size from drawing OCR (e.g. 3.9m × 3.9m under Bedroom). */
  labeledWidthM?: number | null;
  labeledDepthM?: number | null;
  labeledSizeText?: string | null;
  adjacentIds: string[];
  adjacentLabels: string[];
  openings: { doors: string[]; windows: string[] };
};

const MAX_GRID = 320;
const GENERIC_LABELS = new Set(["room", "unit", "space", "area"]);

function live(entities: GeometryInputEntity[]): GeometryInputEntity[] {
  return entities.filter((e) => e.status !== "rejected");
}

function pointsOf(entity: GeometryInputEntity): Pt[] {
  return overlayGeometryPoints(entity.geometry);
}

function bboxOf(pts: Pt[]): { x0: number; y0: number; x1: number; y1: number } | null {
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

function perimeterOf(pts: Pt[]): number {
  if (pts.length < 2) return 0;
  let n = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    n += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return n;
}

function pxToM(px: number, ppm: number | null): number | null {
  if (ppm == null || !(ppm > 0) || !(px > 0)) return null;
  return px / ppm;
}

function closedGeom(geometry: OverlayGeometry): boolean {
  return geometry.kind === "polygon" || geometry.kind === "rect" || geometry.kind === "mask";
}

function stampLine(grid: Int16Array, gw: number, gh: number, x0: number, y0: number, x1: number, y1: number, r = 1): void {
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
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

function fillPoly(
  grid: Int16Array,
  gw: number,
  gh: number,
  pts: Pt[],
  widthPx: number,
  heightPx: number,
  value: number,
): void {
  const box = bboxOf(pts);
  if (!box) return;
  const x0 = Math.max(0, Math.floor((box.x0 / widthPx) * (gw - 1)));
  const y0 = Math.max(0, Math.floor((box.y0 / heightPx) * (gh - 1)));
  const x1 = Math.min(gw - 1, Math.ceil((box.x1 / widthPx) * (gw - 1)));
  const y1 = Math.min(gh - 1, Math.ceil((box.y1 / heightPx) * (gh - 1)));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = (x / (gw - 1)) * widthPx;
      const py = (y / (gh - 1)) * heightPx;
      if (pointInPolygon({ x: px, y: py }, pts)) grid[y * gw + x] = value;
    }
  }
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

function traceOccupiedContour(grid: Int16Array, gw: number, gh: number, id: number): Pt[] {
  const occupied = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < gw && y < gh && grid[y * gw + x] === id;
  const key = (x: number, y: number) => `${x},${y}`;
  const outgoing = new Map<string, Pt[]>();
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
  const path: Pt[] = [{ x: startX, y: startY }];
  let cx = startX;
  let cy = startY;
  const used = new Set<string>();
  for (let guard = 0; guard < gw * gh * 8; guard++) {
    const opts = outgoing.get(key(cx, cy)) ?? [];
    let next: Pt | undefined;
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

function rasterBarriers(
  grid: Int16Array,
  gw: number,
  gh: number,
  barriers: GeometryInputEntity[],
  widthPx: number,
  heightPx: number,
): void {
  const toCell = (p: Pt) => ({
    x: Math.max(0, Math.min(gw - 1, Math.round((p.x / widthPx) * (gw - 1)))),
    y: Math.max(0, Math.min(gh - 1, Math.round((p.y / heightPx) * (gh - 1)))),
  });
  const r = Math.max(1, Math.round(Math.min(gw, gh) * 0.006));
  for (const entity of barriers) {
    if (entity.geometry.kind === "rect") {
      const x0 = Math.max(0, Math.floor((entity.geometry.x / widthPx) * (gw - 1)));
      const y0 = Math.max(0, Math.floor((entity.geometry.y / heightPx) * (gh - 1)));
      const x1 = Math.min(
        gw - 1,
        Math.ceil(((entity.geometry.x + entity.geometry.width) / widthPx) * (gw - 1)),
      );
      const y1 = Math.min(
        gh - 1,
        Math.ceil(((entity.geometry.y + entity.geometry.height) / heightPx) * (gh - 1)),
      );
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) grid[y * gw + x] = -1;
      }
      continue;
    }
    const pts = pointsOf(entity);
    if (closedGeom(entity.geometry) && pts.length >= 3) {
      fillPoly(grid, gw, gh, pts, widthPx, heightPx, -1);
      continue;
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = toCell(pts[i]);
      const b = toCell(pts[i + 1]);
      stampLine(grid, gw, gh, a.x, a.y, b.x, b.y, r);
    }
  }
}

function voteLabel(
  grid: Int16Array,
  gw: number,
  id: number,
  labelGrid: (string | null)[],
  fallback: string,
): string {
  const counts = new Map<string, number>();
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== id) continue;
    const lab = labelGrid[i];
    if (!lab) continue;
    counts.set(lab, (counts.get(lab) ?? 0) + 1);
  }
  if (!counts.size) return fallback;
  const ranked = [...counts.entries()].sort((a, b) => {
    const ag = GENERIC_LABELS.has(a[0].toLowerCase()) ? 1 : 0;
    const bg = GENERIC_LABELS.has(b[0].toLowerCase()) ? 1 : 0;
    if (ag !== bg) return ag - bg;
    return b[1] - a[1];
  });
  return ranked[0][0] || fallback;
}

function punchDoorGaps(
  grid: Int16Array,
  gw: number,
  gh: number,
  widthPx: number,
  heightPx: number,
  gaps: Pt[],
): void {
  if (!gaps.length) return;
  const gapR = Math.max(1, Math.round(Math.min(gw, gh) * 0.012));
  const toCell = (p: Pt) => ({
    x: Math.max(0, Math.min(gw - 1, Math.round((p.x / widthPx) * (gw - 1)))),
    y: Math.max(0, Math.min(gh - 1, Math.round((p.y / heightPx) * (gh - 1)))),
  });
  for (const gap of gaps) {
    const c = toCell(gap);
    for (let y = c.y - gapR; y <= c.y + gapR; y++) {
      for (let x = c.x - gapR; x <= c.x + gapR; x++) {
        if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
        if (grid[y * gw + x] === -1) grid[y * gw + x] = 0;
      }
    }
  }
}

function componentsInClip(args: {
  barriers: GeometryInputEntity[];
  clip: Pt[] | null;
  widthPx: number;
  heightPx: number;
  labelEntities: GeometryInputEntity[];
  fallbackLabel: string;
  dropIfTouchesBorder: boolean;
  /** Internal door centroids punched through wall barriers. */
  internalDoorGaps?: Pt[];
  /** Keep only components reachable from a main-door entry seed. */
  entrySeeds?: Pt[];
}): { points: Pt[]; label: string; cells: number }[] {
  const {
    barriers,
    clip,
    widthPx,
    heightPx,
    labelEntities,
    fallbackLabel,
    dropIfTouchesBorder,
    internalDoorGaps = [],
    entrySeeds = [],
  } = args;
  if (widthPx < 2 || heightPx < 2) return [];
  const scale = Math.min(MAX_GRID / widthPx, MAX_GRID / heightPx, 1);
  const gw = Math.max(8, Math.round(widthPx * scale));
  const gh = Math.max(8, Math.round(heightPx * scale));
  const grid = new Int16Array(gw * gh);
  const labelGrid: (string | null)[] = new Array(gw * gh).fill(null);
  const toPage = (x: number, y: number): Pt => ({
    x: (x / gw) * widthPx,
    y: (y / gh) * heightPx,
  });

  if (clip && clip.length >= 3) {
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const p = toPage(x, y);
        if (!pointInPolygon(p, clip)) grid[y * gw + x] = -2;
      }
    }
  }

  rasterBarriers(grid, gw, gh, barriers, widthPx, heightPx);
  punchDoorGaps(grid, gw, gh, widthPx, heightPx, internalDoorGaps);

  for (const entity of labelEntities) {
    const pts = pointsOf(entity);
    if (pts.length < 3) continue;
    const box = bboxOf(pts);
    if (!box) continue;
    const x0 = Math.max(0, Math.floor((box.x0 / widthPx) * (gw - 1)));
    const y0 = Math.max(0, Math.floor((box.y0 / heightPx) * (gh - 1)));
    const x1 = Math.min(gw - 1, Math.ceil((box.x1 / widthPx) * (gw - 1)));
    const y1 = Math.min(gh - 1, Math.ceil((box.y1 / heightPx) * (gh - 1)));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const p = toPage(x, y);
        if (pointInPolygon(p, pts)) labelGrid[y * gw + x] = entity.label;
      }
    }
  }

  let clipCells = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === 0) clipCells++;
  }
  const minCells = Math.max(8, Math.round(clipCells * 0.004));
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  const out: { points: Pt[]; label: string; cells: number }[] = [];
  let nextId = 1;
  const eps = Math.max(3, Math.min(widthPx, heightPx) * 0.006);

  for (let seed = 0; seed < grid.length; seed++) {
    if (grid[seed] !== 0) continue;
    const id = nextId++;
    const sx = seed % gw;
    const sy = Math.floor(seed / gw);
    const queue = [{ x: sx, y: sy }];
    grid[seed] = id;
    let claimed = 1;
    let touchesBorder = false;
    let qh = 0;
    while (qh < queue.length) {
      const cur = queue[qh++];
      if (cur.x === 0 || cur.y === 0 || cur.x === gw - 1 || cur.y === gh - 1) touchesBorder = true;
      for (const [dx, dy] of dirs) {
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const i = ny * gw + nx;
        if (grid[i] !== 0) continue;
        grid[i] = id;
        claimed++;
        queue.push({ x: nx, y: ny });
      }
    }
    if (claimed < minCells) continue;
    if (dropIfTouchesBorder && touchesBorder && claimed / Math.max(1, clipCells) > 0.7) continue;
    const corners = traceOccupiedContour(grid, gw, gh, id);
    if (corners.length < 3) continue;
    const points = simplifyClosed(
      corners.map((c) => toPage(c.x, c.y)),
      eps,
    );
    if (points.length < 3) continue;
    out.push({
      points,
      label: voteLabel(grid, gw, id, labelGrid, fallbackLabel),
      cells: claimed,
    });
  }

  if (!entrySeeds.length) return out;
  const pad = Math.max(12, Math.min(widthPx, heightPx) * 0.01);
  return out.filter((part) =>
    entrySeeds.some(
      (seed) => pointInPolygon(seed, part.points) || distToRing(seed, part.points) <= pad,
    ),
  );
}

function expandBox(
  box: { x0: number; y0: number; x1: number; y1: number },
  pad: number,
) {
  return { x0: box.x0 - pad, y0: box.y0 - pad, x1: box.x1 + pad, y1: box.y1 + pad };
}

function boxesOverlap(
  a: { x0: number; y0: number; x1: number; y1: number },
  b: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
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

function containingUnit(pt: Pt, units: GeometryInputEntity[]): GeometryInputEntity | null {
  let best: GeometryInputEntity | null = null;
  let bestArea = Infinity;
  for (const unit of units) {
    const poly = pointsOf(unit);
    if (poly.length < 3 || !pointInPolygon(pt, poly)) continue;
    const area = polygonAreaPx2(poly);
    if (area < bestArea) {
      best = unit;
      bestArea = area;
    }
  }
  return best;
}

function centroidCovered(pt: Pt, rooms: { points: Pt[] }[]): boolean {
  return rooms.some((room) => room.points.length >= 3 && pointInPolygon(pt, room.points));
}

export function distToRing(pt: Pt, ring: Pt[]): number {
  if (pointInPolygon(pt, ring)) return 0;
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy)));
  }
  return best;
}

/**
 * Units first, then interiors enclosed by walls/doors/windows inside each unit.
 * Leftover sheet interiors become common (lobby / corridor).
 */
export function extractWallBoundedRooms(args: {
  entities: GeometryInputEntity[];
  widthPx: number;
  heightPx: number;
  pixelsPerMeter?: number | null;
  mainDoorWidth?: MainDoorWidthOpts;
}): ExtractedGeometryRoom[] {
  const entities = live(args.entities);
  const widthPx = args.widthPx;
  const heightPx = args.heightPx;
  const ppm = args.pixelsPerMeter ?? null;
  const drawing = entities.find((e) => e.type === "main_floorplan");
  const drawingClip = drawing && pointsOf(drawing).length >= 3 ? pointsOf(drawing) : null;

  const walls = entities.filter((e) => isWallOverlayEntity(e));
  const windows = entities.filter((e) => e.type === "window");
  const openings = entities.filter((e) => e.type === "door" || e.type === "window");
  const doorLikes = doorLikesFromEntities(entities as OverlayEntity[]);
  const mainDoorIds = classifyMainDoorsByWidth(doorLikes, args.mainDoorWidth);
  const internalDoorGaps = doorLikes
    .filter((d) => !mainDoorIds.has(d.id) && !isExplicitMainDoorLabel(d.label))
    .map((d) => d.centroid);
  /** Walls and windows block; internal doors are openings only. */
  const barriers = [...walls, ...windows];
  const units = entities.filter((e) => isUnitOutlineEntity(e) && pointsOf(e).length >= 3);
  const rooms = entities.filter((e) => isRoomOverlayEntity(e) && pointsOf(e).length >= 3);

  const clips: { unitId: string | null; unitLabel: string | null; isCommon: boolean; poly: Pt[] | null }[] =
    units.length > 0
      ? units.map((u) => ({
          unitId: u.id,
          unitLabel: u.label,
          isCommon: false,
          poly: pointsOf(u),
        }))
      : [{ unitId: null, unitLabel: null, isCommon: false, poly: drawingClip }];

  const extracted: ExtractedGeometryRoom[] = [];
  let seq = 0;

  const finish = (
    parts: { points: Pt[]; label: string }[],
    unitId: string | null,
    unitLabel: string | null,
    isCommon: boolean,
  ) => {
    for (const part of parts) {
      const box = bboxOf(part.points);
      if (!box) continue;
      const widthPxRoom = Math.max(box.x1 - box.x0, box.y1 - box.y0);
      const depthPxRoom = Math.min(box.x1 - box.x0, box.y1 - box.y0);
      const areaPx2 = polygonAreaPx2(part.points);
      const peri = perimeterOf(part.points);
      const label = part.label || (isCommon ? "Corridor" : "Room");
      extracted.push({
        id: `geo-room-${seq++}`,
        label,
        unitId,
        unitLabel,
        isCommon: isCommon || isCommonRoomLabel(label),
        points: part.points,
        areaPx2,
        widthPx: widthPxRoom,
        depthPx: depthPxRoom,
        perimeterPx: peri,
        areaM2: areaM2FromPx(areaPx2, ppm),
        widthM: pxToM(widthPxRoom, ppm),
        depthM: pxToM(depthPxRoom, ppm),
        perimeterM: pxToM(peri, ppm),
        adjacentIds: [],
        adjacentLabels: [],
        openings: { doors: [], windows: [] },
      });
    }
  };

  const unitPolys = clips.filter((c) => !c.isCommon && c.poly).map((c) => c.poly as Pt[]);

  for (const room of rooms) {
    const pts = pointsOf(room);
    if (pts.length < 3 || polygonAreaPx2(pts) < 4) continue;
    const host = containingUnit(centroidOf(pts), units);
    finish(
      [{ points: pts, label: room.label }],
      host?.id ?? null,
      host?.label ?? null,
      isCommonRoomLabel(room.label),
    );
  }

  if (barriers.length > 0) {
    const pad = Math.max(12, Math.min(widthPx, heightPx) * 0.015);
    for (const clip of clips) {
      const unitPoly = clip.poly;
      const entrySeeds =
        unitPoly && unitPoly.length >= 3
          ? doorLikes
              .filter((d) => mainDoorIds.has(d.id) || isExplicitMainDoorLabel(d.label))
              .filter((d) => distToRing(d.centroid, unitPoly) <= pad * 3)
              .map((d) => unitSeedBehindMainDoor(d.centroid, centroidOf(unitPoly), Math.max(pad, 12)))
          : [];
      const parts = componentsInClip({
        barriers,
        clip: clip.poly,
        widthPx,
        heightPx,
        labelEntities: rooms,
        fallbackLabel: clip.isCommon ? "Corridor" : "Room",
        dropIfTouchesBorder: Boolean(!clip.poly && !units.length),
        internalDoorGaps,
        entrySeeds,
      }).filter((part) => !centroidCovered(centroidOf(part.points), extracted));
      finish(parts, clip.unitId, clip.unitLabel, clip.isCommon);
    }

    if (units.length > 0) {
      const remainderClip: Pt[] = drawingClip ?? [
        { x: 0, y: 0 },
        { x: widthPx, y: 0 },
        { x: widthPx, y: heightPx },
        { x: 0, y: heightPx },
      ];
      const commonParts = componentsInClip({
        barriers: [
          ...barriers,
          ...units.map((u) => ({
            ...u,
            type: "wall",
          })),
        ],
        clip: remainderClip,
        widthPx,
        heightPx,
        labelEntities: rooms.filter((r) => isCommonRoomLabel(r.label)),
        fallbackLabel: "Corridor",
        dropIfTouchesBorder: true,
        internalDoorGaps,
      }).filter((part) => {
        const c = centroidOf(part.points);
        if (centroidCovered(c, extracted)) return false;
        return !unitPolys.some((poly) => pointInPolygon(c, poly));
      });
      finish(commonParts, null, null, true);
    }
  }

  const pad = adjacencyPadPx(ppm);
  for (let i = 0; i < extracted.length; i++) {
    const a = extracted[i];
    const ab = expandBox(bboxOf(a.points)!, pad);
    for (let j = 0; j < extracted.length; j++) {
      if (i === j) continue;
      const b = extracted[j];
      const sameGroup =
        a.isCommon && b.isCommon
          ? true
          : Boolean(a.unitId && b.unitId && a.unitId === b.unitId);
      if (!sameGroup) continue;
      const bb = expandBox(bboxOf(b.points)!, pad);
      if (!boxesOverlap(ab, bb)) continue;
      a.adjacentIds.push(b.id);
      a.adjacentLabels.push(b.label);
    }
  }

  const openPad = Math.max(pad, Math.min(widthPx, heightPx) * 0.01);
  for (const opening of openings) {
    const pts = pointsOf(opening);
    const c = centroidOf(pts);
    let best: ExtractedGeometryRoom | null = null;
    let bestD = openPad;
    for (const room of extracted) {
      const d = distToRing(c, room.points);
      if (d < bestD) {
        bestD = d;
        best = room;
      }
    }
    if (!best) continue;
    if (opening.type === "window") best.openings.windows.push(opening.label);
    else best.openings.doors.push(opening.label);
  }

  extracted.sort((a, b) => {
    const ua = a.unitLabel ?? "zzz";
    const ub = b.unitLabel ?? "zzz";
    if (ua !== ub) return ua.localeCompare(ub);
    return b.areaPx2 - a.areaPx2;
  });
  return extracted;
}

export function roomsToOverlayEntities(rooms: ExtractedGeometryRoom[]): OverlayEntity[] {
  const now = new Date().toISOString();
  return rooms.map((room) => ({
    id: room.id,
    type: "room",
    layer: ENTITY_LAYER.room,
    geometry: { kind: "polygon", points: room.points },
    label: room.label,
    confidence: 1,
    status: "predicted",
    source: "geometry",
    attributes: {
      extractMethod: "wall_bounded",
      unitId: room.unitId,
      unitLabel: room.unitLabel,
      isCommon: room.isCommon,
      ...(room.labeledWidthM != null ? { labeledWidthM: room.labeledWidthM } : {}),
      ...(room.labeledDepthM != null ? { labeledDepthM: room.labeledDepthM } : {}),
      ...(room.labeledSizeText ? { labeledSizeText: room.labeledSizeText } : {}),
    },
    createdAt: now,
    updatedAt: now,
  }));
}

export function extractedRoomsFromPolygons(
  regions: {
    id: string;
    label: string;
    polygonPx: Pt[];
    attributes?: Record<string, unknown>;
  }[],
  pixelsPerMeter?: number | null,
): ExtractedGeometryRoom[] {
  const ppm = pixelsPerMeter ?? null;
  return regions
    .filter((r) => r.polygonPx.length >= 3)
    .map((region, i) => {
      const points = region.polygonPx;
      const box = bboxOf(points);
      const widthPxRoom = box ? Math.max(box.x1 - box.x0, box.y1 - box.y0) : 0;
      const depthPxRoom = box ? Math.min(box.x1 - box.x0, box.y1 - box.y0) : 0;
      const areaPx2 = polygonAreaPx2(points);
      const peri = perimeterOf(points);
      const unitLabel =
        typeof region.attributes?.unitLabel === "string" ? region.attributes.unitLabel : null;
      const unitId = typeof region.attributes?.unitId === "string" ? region.attributes.unitId : null;
      const label = region.label || "Room";
      return {
        id: region.id || `geo-room-${i}`,
        label,
        unitId,
        unitLabel,
        isCommon: Boolean(region.attributes?.isCommon) || isCommonRoomLabel(label),
        points,
        areaPx2,
        widthPx: widthPxRoom,
        depthPx: depthPxRoom,
        perimeterPx: peri,
        areaM2: areaM2FromPx(areaPx2, ppm),
        widthM: pxToM(widthPxRoom, ppm),
        depthM: pxToM(depthPxRoom, ppm),
        perimeterM: pxToM(peri, ppm),
        adjacentIds: [],
        adjacentLabels: Array.isArray(region.attributes?.adjacentLabels)
          ? (region.attributes.adjacentLabels as string[])
          : [],
        openings: {
          doors: Array.isArray(region.attributes?.doors) ? (region.attributes.doors as string[]) : [],
          windows: Array.isArray(region.attributes?.windows)
            ? (region.attributes.windows as string[])
            : [],
        },
      };
    });
}
