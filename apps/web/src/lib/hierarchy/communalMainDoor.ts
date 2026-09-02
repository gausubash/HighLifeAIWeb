import type { Pt } from "./inferUnitBoundaries";

export type DoorLike = {
  id: string;
  label: string;
  centroid: Pt;
  /** Opening width (px) — shorter bbox side for rects; shortest edge or min bbox for polygons. */
  spanPx: number;
};

function edgeLen(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function uniqueRingPoints(points: Pt[]): Pt[] {
  if (points.length <= 1) return points;
  const out = [...points];
  const last = out[out.length - 1];
  const first = out[0];
  if (Math.hypot(last.x - first.x, last.y - first.y) < 1e-6) out.pop();
  return out;
}

/** Shorter side of an axis-aligned box — opening width for upright door rectangles. */
export function doorOpeningSpanPx(box: { x0: number; y0: number; x1: number; y1: number }): number {
  const w = Math.max(0, box.x1 - box.x0);
  const h = Math.max(0, box.y1 - box.y0);
  if (w === 0) return h;
  if (h === 0) return w;
  return Math.min(w, h);
}

export function doorOpeningSpanFromRect(width: number, height: number): number {
  const w = Math.max(0, Math.abs(width));
  const h = Math.max(0, Math.abs(height));
  if (w === 0) return h;
  if (h === 0) return w;
  return Math.min(w, h);
}

/**
 * Opening width from polygon points. Four-corner quads use the shortest edge;
 * other shapes fall back to the shorter side of the axis-aligned bbox.
 */
export function doorOpeningSpanFromPoints(points: Pt[]): number {
  if (!points.length) return 0;
  const ring = uniqueRingPoints(points);
  if (ring.length === 4) {
    const edges = ring.map((p, i) => edgeLen(p, ring[(i + 1) % 4]!));
    return Math.min(...edges);
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of ring) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return doorOpeningSpanPx({ x0, y0, x1, y1 });
}

export type MainDoorWidthMode = "auto" | "threshold";

export type MainDoorWidthOpts = {
  mode?: MainDoorWidthMode;
  /** Minimum opening width (px) for threshold mode. */
  minSpanPx?: number;
};

export const DEFAULT_MAIN_DOOR_MIN_SPAN_PX = 29;

function normLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[_-]+/g, " ");
}

export function isExplicitMainDoorLabel(label: string): boolean {
  return normLabel(label) === "main door";
}

function distPointToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.hypot(p.x - px, p.y - py);
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

/** Minimum distance from a point to a closed polygon (0 when inside). */
export function minDistToPolygon(p: Pt, poly: Pt[]): number {
  if (poly.length < 3) return Infinity;
  if (pointInPoly(p.x, p.y, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    best = Math.min(best, distPointToSegment(p, a, b));
  }
  return best;
}

export function nearCommunalRegion(centroid: Pt, communalPolys: Pt[][], padPx: number): boolean {
  for (const poly of communalPolys) {
    if (minDistToPolygon(centroid, poly) <= padPx) return true;
  }
  return false;
}

/** Doors touching the OCR-flooded lobby/corridor/lift region are unit entrances. */
export function classifyMainDoorsFromCommunal(
  doors: DoorLike[],
  communalPolys: Pt[][],
  padPx: number,
): Set<string> {
  const mains = new Set<string>();
  if (!communalPolys.length) return mains;
  for (const door of doors) {
    if (isExplicitMainDoorLabel(door.label)) {
      mains.add(door.id);
      continue;
    }
    if (nearCommunalRegion(door.centroid, communalPolys, padPx)) {
      mains.add(door.id);
    }
  }
  return mains;
}

/** Auto split threshold from opening-span distribution (for UI readout). */
export function autoMainDoorSplitSpan(doors: DoorLike[]): number | null {
  const candidates = doors.filter((d) => d.spanPx > 0);
  if (candidates.length < 2) return null;

  const spans = [...candidates.map((d) => d.spanPx)].sort((a, b) => a - b);
  const minSpan = spans[0] ?? 0;
  const maxSpan = spans[spans.length - 1] ?? minSpan;

  let splitAt = minSpan + (maxSpan - minSpan) * 0.5;
  let bestGap = 0;
  for (let i = 0; i < spans.length - 1; i++) {
    const gap = spans[i + 1] - spans[i];
    if (gap > bestGap) {
      bestGap = gap;
      splitAt = (spans[i] + spans[i + 1]) / 2;
    }
  }

  const gapSplit = bestGap >= Math.max(2, minSpan * 0.12);
  const ratioSplit = maxSpan > minSpan * 1.12;
  if (!gapSplit && !ratioSplit) return null;
  if (!gapSplit && ratioSplit) {
    splitAt = minSpan + (maxSpan - minSpan) * 0.35;
  }
  return splitAt;
}

/**
 * Unit entrance doors are wider than internal room doors on the same sheet.
 * Threshold mode uses a fixed min span; auto mode uses a gap in sorted spans.
 */
export function classifyMainDoorsByWidth(doors: DoorLike[], opts?: MainDoorWidthOpts): Set<string> {
  const mains = new Set<string>();
  const candidates = doors.filter((d) => d.spanPx > 0);
  if (!candidates.length) return mains;

  for (const door of candidates) {
    if (isExplicitMainDoorLabel(door.label)) mains.add(door.id);
  }

  const mode = opts?.mode ?? "auto";
  if (mode === "threshold") {
    const minSpan = opts?.minSpanPx ?? DEFAULT_MAIN_DOOR_MIN_SPAN_PX;
    for (const door of candidates) {
      if (door.spanPx >= minSpan) mains.add(door.id);
    }
    return mains;
  }

  if (candidates.length === 1) {
    if (!mains.size) mains.add(candidates[0].id);
    return mains;
  }

  const splitAt = autoMainDoorSplitSpan(candidates);
  if (splitAt == null) return mains;

  for (const door of candidates) {
    if (door.spanPx >= splitAt) mains.add(door.id);
  }
  return mains;
}

export function communalRegionCentroid(polys: Pt[][]): Pt {
  const pts: Pt[] = [];
  for (const poly of polys) pts.push(...poly);
  if (!pts.length) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / pts.length, y: sy / pts.length };
}

/** Step from a main door into the apartment, away from the communal spine. */
export function unitSeedBehindMainDoor(doorCentroid: Pt, communalCentroid: Pt, stepPx: number): Pt {
  const dx = doorCentroid.x - communalCentroid.x;
  const dy = doorCentroid.y - communalCentroid.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: doorCentroid.x, y: doorCentroid.y + stepPx };
  return {
    x: doorCentroid.x + (dx / len) * stepPx,
    y: doorCentroid.y + (dy / len) * stepPx,
  };
}

/**
 * When lobby/corridor OCR is missing, seed communal flood from a row of aligned doors
 * (typical lift-lobby / corridor entries to apartments).
 */
export function inferCorridorSeedsFromDoors(
  doors: DoorLike[],
  padPx: number,
  widthOpts?: MainDoorWidthOpts,
): Pt[] {
  if (!doors.length) return [];

  const byWidth = classifyMainDoorsByWidth(doors, widthOpts);
  const entranceDoors =
    byWidth.size >= 2 ? doors.filter((d) => byWidth.has(d.id)) : byWidth.size ? doors.filter((d) => byWidth.has(d.id)) : doors;

  if (!entranceDoors.length) return [];
  if (entranceDoors.length === 1) {
    return [{ x: entranceDoors[0].centroid.x, y: entranceDoors[0].centroid.y - padPx * 2 }];
  }

  const alignTol = padPx * 2;
  const horizontalRows = new Map<number, DoorLike[]>();
  const verticalRows = new Map<number, DoorLike[]>();

  for (const door of entranceDoors) {
    const yKey = Math.round(door.centroid.y / alignTol);
    const xKey = Math.round(door.centroid.x / alignTol);
    const hRow = horizontalRows.get(yKey) ?? [];
    hRow.push(door);
    horizontalRows.set(yKey, hRow);
    const vRow = verticalRows.get(xKey) ?? [];
    vRow.push(door);
    verticalRows.set(xKey, vRow);
  }

  let bestRow: DoorLike[] | null = null;
  let bestSpan = 0;
  let axis: "h" | "v" = "h";

  for (const row of horizontalRows.values()) {
    if (row.length < 2) continue;
    const xs = row.map((d) => d.centroid.x);
    const span = Math.max(...xs) - Math.min(...xs);
    if (span > bestSpan) {
      bestSpan = span;
      bestRow = row;
      axis = "h";
    }
  }
  for (const row of verticalRows.values()) {
    if (row.length < 2) continue;
    const ys = row.map((d) => d.centroid.y);
    const span = Math.max(...ys) - Math.min(...ys);
    if (span > bestSpan) {
      bestSpan = span;
      bestRow = row;
      axis = "v";
    }
  }
  if (!bestRow || bestRow.length < 2) return [];

  const xs = bestRow.map((d) => d.centroid.x);
  const ys = bestRow.map((d) => d.centroid.y);
  const cx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const cy = ys.reduce((s, v) => s + v, 0) / ys.length;
  const step = padPx * 2.5;

  if (axis === "h") {
    const seeds: Pt[] = [];
    for (const x of [Math.min(...xs), cx, Math.max(...xs)]) {
      seeds.push({ x, y: cy - step }, { x, y: cy + step });
    }
    return seeds;
  }
  const seeds: Pt[] = [];
  for (const y of [Math.min(...ys), cy, Math.max(...ys)]) {
    seeds.push({ x: cx - step, y }, { x: cx + step, y });
  }
  return seeds;
}

/** OCR lobby/corridor/lift text, common-room overlays, or aligned door row. */
export function buildCommunalSeedPoints(input: {
  ocrCentroids: Pt[];
  commonRoomCentroids: Pt[];
  doors: DoorLike[];
  padPx: number;
  mainDoorWidth?: MainDoorWidthOpts;
}): Pt[] {
  const explicit = [...input.ocrCentroids, ...input.commonRoomCentroids];
  if (explicit.length) return explicit;
  return inferCorridorSeedsFromDoors(input.doors, input.padPx, input.mainDoorWidth);
}

/** Classify unit entrances: wide opening + communal spine when available. */
export function classifyUnitEntranceDoors(
  doors: DoorLike[],
  communalPolys: Pt[][],
  padPx: number,
  widthOpts?: MainDoorWidthOpts,
): Set<string> {
  const byWidth = classifyMainDoorsByWidth(doors, widthOpts);
  if (widthOpts?.mode === "threshold" && byWidth.size) {
    return byWidth;
  }

  if (byWidth.size) {
    if (communalPolys.length) {
      const onSpine = new Set<string>();
      for (const door of doors) {
        if (!byWidth.has(door.id)) continue;
        if (nearCommunalRegion(door.centroid, communalPolys, padPx * 2.5)) {
          onSpine.add(door.id);
        }
      }
      if (onSpine.size) return onSpine;
    }
    if (byWidth.size >= 2) return byWidth;
  }

  let mains = classifyMainDoorsFromCommunal(doors, communalPolys, padPx);
  if (mains.size) return mains;
  mains = classifyMainDoorsFromCommunal(doors, communalPolys, padPx * 2);
  if (mains.size) return mains;

  if (!communalPolys.length) return byWidth;

  for (const door of doors) {
    if (nearCommunalRegion(door.centroid, communalPolys, padPx * 2.5)) {
      mains.add(door.id);
    }
  }
  return mains;
}
