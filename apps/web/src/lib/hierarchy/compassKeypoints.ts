export type CompassKeypointName = "tip" | "base";

/** Roboflow / COCO: v=2 visible, v=1 occluded, v=0 not labeled. */
export type KeypointVisibility = "visible" | "occluded" | "not_labeled";

export type CompassKeypoint = {
  name: CompassKeypointName;
  x: number;
  y: number;
  visibility: KeypointVisibility;
  confidence?: number;
  source?: "model" | "derived";
};

export type CompassKeypointVisible = Record<CompassKeypointName, boolean>;

export const COMPASS_KEYPOINT_NAMES: CompassKeypointName[] = ["tip", "base"];

export const DEFAULT_COMPASS_KEYPOINT_VISIBLE: CompassKeypointVisible = {
  tip: true,
  base: true,
};

export const COMPASS_KEYPOINT_SWATCH: Record<CompassKeypointName, string> = {
  tip: "#dc2626",
  base: "#2563eb",
};

const TIP_ALIASES = new Set([
  "tip",
  "head",
  "north",
  "arrow_tip",
  "arrowhead",
  "arrow head",
  "point",
  "n",
]);
const BASE_ALIASES = new Set([
  "base",
  "tail",
  "origin",
  "arrow_base",
  "arrow tail",
  "pivot",
  "s",
  "south",
]);

type Pt = { x: number; y: number };

function normName(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function cocoVisibility(value: unknown): KeypointVisibility {
  if (value == null || value === "") return "visible";
  if (typeof value === "boolean") return value ? "visible" : "not_labeled";
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) return "not_labeled";
    if (value === 1) return "occluded";
    return "visible";
  }
  const raw = String(value).trim().toLowerCase().replace(/[_-]+/g, " ");
  if (raw === "0" || raw === "not labeled" || raw === "unlabeled" || raw === "hidden" || raw === "none") {
    return "not_labeled";
  }
  if (raw === "1" || raw === "occluded" || raw === "invisible") return "occluded";
  if (raw === "2" || raw === "visible" || raw === "labeled") return "visible";
  if (raw === "true") return "visible";
  if (raw === "false") return "not_labeled";
  return "visible";
}

export function compassKeypointRole(name: string | null | undefined, index: number, count: number): CompassKeypointName | null {
  const key = name ? normName(name) : "";
  if (TIP_ALIASES.has(key) || key.includes("tip") || key.includes("head")) return "tip";
  if (BASE_ALIASES.has(key) || key.includes("base") || key.includes("tail")) return "base";
  if (count === 2) return index === 0 ? "base" : "tip";
  return null;
}

function asNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function fromRecord(raw: Record<string, unknown>, nameHint: string | null, index: number, count: number): CompassKeypoint | null {
  const x = asNumber(raw.x ?? raw.cx);
  const y = asNumber(raw.y ?? raw.cy);
  if (x == null || y == null) return null;
  const nameRaw =
    (typeof raw.class === "string" && raw.class) ||
    (typeof raw.name === "string" && raw.name) ||
    (typeof raw.label === "string" && raw.label) ||
    nameHint;
  const name = compassKeypointRole(nameRaw, index, count);
  if (!name) return null;
  const occluded = raw.occluded === true || raw.occluded === 1;
  const visibility = occluded ? "occluded" : cocoVisibility(raw.visibility ?? raw.v ?? raw.visible);
  const confidence = asNumber(raw.confidence ?? raw.conf ?? raw.score) ?? undefined;
  return {
    name,
    x,
    y,
    visibility,
    ...(confidence != null ? { confidence } : {}),
    source: "model",
  };
}

function parseKeypointList(raw: unknown): CompassKeypoint[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (raw.every((item) => typeof item === "number" || typeof item === "string")) {
    const nums = raw.map((item) => Number(item)).filter((n) => Number.isFinite(n));
    const out: CompassKeypoint[] = [];
    const count = Math.floor(nums.length / 3);
    for (let i = 0; i < count; i++) {
      const name = compassKeypointRole(null, i, count);
      if (!name) continue;
      out.push({
        name,
        x: nums[i * 3],
        y: nums[i * 3 + 1],
        visibility: cocoVisibility(nums[i * 3 + 2]),
        source: "model",
      });
    }
    return mergeNamed(out);
  }
  const items = raw.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  const mapped = items
    .map((item, index) => fromRecord(item, null, index, items.length))
    .filter((item): item is CompassKeypoint => item != null);
  return mergeNamed(mapped);
}

function parseNamedMap(raw: Record<string, unknown>): CompassKeypoint[] {
  const out: CompassKeypoint[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const parsed = fromRecord(value as Record<string, unknown>, key, out.length, 2);
    if (parsed) out.push(parsed);
  }
  return mergeNamed(out);
}

function mergeNamed(items: CompassKeypoint[]): CompassKeypoint[] {
  const byName = new Map<CompassKeypointName, CompassKeypoint>();
  for (const item of items) {
    const prev = byName.get(item.name);
    if (!prev || (item.confidence ?? 0) >= (prev.confidence ?? 0)) byName.set(item.name, item);
  }
  return COMPASS_KEYPOINT_NAMES.map((name) => byName.get(name)).filter(
    (item): item is CompassKeypoint => item != null,
  );
}

/** Parse Roboflow / YOLO / stored overlay attributes into tip + base keypoints. */
export function parseCompassKeypoints(attributes?: Record<string, unknown> | null): CompassKeypoint[] {
  if (!attributes) return [];
  const nested = attributes.keypoints ?? attributes.compassKeypoints ?? attributes.kpts;
  if (Array.isArray(nested)) return parseKeypointList(nested);
  if (nested && typeof nested === "object") {
    const asRecord = nested as Record<string, unknown>;
    if (Array.isArray(asRecord.keypoints)) return parseKeypointList(asRecord.keypoints);
    const fromMap = parseNamedMap(asRecord);
    if (fromMap.length) return fromMap;
  }
  const tip = attributes.tip;
  const base = attributes.base;
  const fromEnds: CompassKeypoint[] = [];
  if (tip && typeof tip === "object") {
    const parsed = fromRecord(tip as Record<string, unknown>, "tip", 1, 2);
    if (parsed) fromEnds.push(parsed);
  }
  if (base && typeof base === "object") {
    const parsed = fromRecord(base as Record<string, unknown>, "base", 0, 2);
    if (parsed) fromEnds.push(parsed);
  }
  return mergeNamed(fromEnds);
}

export function compassKeypointByName(
  keypoints: CompassKeypoint[],
  name: CompassKeypointName,
): CompassKeypoint | undefined {
  return keypoints.find((item) => item.name === name);
}

export function isCompassKeypointDrawable(
  keypoint: CompassKeypoint | undefined,
  show: boolean,
): keypoint is CompassKeypoint {
  return Boolean(show && keypoint);
}

export function headingFromCompassKeypoints(keypoints: CompassKeypoint[]): number | null {
  const tip = compassKeypointByName(keypoints, "tip");
  const base = compassKeypointByName(keypoints, "base");
  if (!tip || !base) return null;
  const dx = tip.x - base.x;
  const dy = tip.y - base.y;
  if (dx === 0 && dy === 0) return null;
  return ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
}

/**
 * Survey bearing of the north arrow on the sheet: 0° = toward the top of the
 * page, clockwise (90° = right, 180° = bottom). Image Y increases downward, so
 * this is atan2(tip.x − base.x, base.y − tip.y).
 */
export function pageBearingFromTipBase(base: Pt, tip: Pt): number | null {
  const dx = tip.x - base.x;
  const dy = tip.y - base.y;
  if (dx === 0 && dy === 0) return null;
  return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
}

export function pageBearingFromCompassKeypoints(keypoints: CompassKeypoint[]): number | null {
  const tip = compassKeypointByName(keypoints, "tip");
  const base = compassKeypointByName(keypoints, "base");
  if (!tip || !base) return null;
  return pageBearingFromTipBase(base, tip);
}

export function headingVecFromCompassKeypoints(keypoints: CompassKeypoint[]): Pt | null {
  const tip = compassKeypointByName(keypoints, "tip");
  const base = compassKeypointByName(keypoints, "base");
  if (!tip || !base) return null;
  const x = tip.x - base.x;
  const y = tip.y - base.y;
  if (x === 0 && y === 0) return null;
  return { x, y };
}

/** Place tip/base at the polygon extrema along the heading (OBB / box-only north arrows). */
export function deriveCompassKeypoints(points: Pt[], headingDeg: number): CompassKeypoint[] {
  if (points.length < 2 || !Number.isFinite(headingDeg)) return [];
  const rad = (headingDeg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  let minP = points[0];
  let maxP = points[0];
  let minProj = minP.x * ux + minP.y * uy;
  let maxProj = minProj;
  for (const p of points) {
    const proj = p.x * ux + p.y * uy;
    if (proj < minProj) {
      minProj = proj;
      minP = p;
    }
    if (proj > maxProj) {
      maxProj = proj;
      maxP = p;
    }
  }
  if (minP.x === maxP.x && minP.y === maxP.y) return [];
  return [
    { name: "base", x: minP.x, y: minP.y, visibility: "visible", source: "derived" },
    { name: "tip", x: maxP.x, y: maxP.y, visibility: "visible", source: "derived" },
  ];
}

export function offsetCompassKeypoints(keypoints: CompassKeypoint[], dx: number, dy: number): CompassKeypoint[] {
  if (!dx && !dy) return keypoints;
  return keypoints.map((item) => ({ ...item, x: item.x + dx, y: item.y + dy }));
}

export function offsetCompassKeypointsInAttributes(
  attributes: Record<string, unknown> | undefined,
  dx: number,
  dy: number,
): Record<string, unknown> | undefined {
  if (!attributes || (!dx && !dy)) return attributes;
  const keypoints = parseCompassKeypoints(attributes);
  if (!keypoints.length) return attributes;
  return { ...attributes, keypoints: offsetCompassKeypoints(keypoints, dx, dy) };
}

export function serializeCompassKeypoints(keypoints: CompassKeypoint[]): Array<Record<string, unknown>> {
  return keypoints.map((item) => ({
    name: item.name,
    x: item.x,
    y: item.y,
    visibility: item.visibility,
    ...(item.confidence != null ? { confidence: item.confidence } : {}),
    ...(item.source ? { source: item.source } : {}),
  }));
}

/** Model keypoints if present; otherwise derived from heading + polygon. */
export function resolveCompassKeypoints(
  attributes: Record<string, unknown> | null | undefined,
  points: Pt[],
  headingDeg?: number | null,
): CompassKeypoint[] {
  const parsed = parseCompassKeypoints(attributes);
  if (parsed.length) return parsed;
  if (headingDeg == null || !Number.isFinite(headingDeg)) return [];
  return deriveCompassKeypoints(points, headingDeg);
}

export function patchCompassKeypointVisibility(
  attributes: Record<string, unknown>,
  name: CompassKeypointName,
  visibility: KeypointVisibility,
  points: Pt[],
  headingDeg?: number | null,
): Record<string, unknown> {
  const current = resolveCompassKeypoints(attributes, points, headingDeg);
  const next = COMPASS_KEYPOINT_NAMES.map((key) => {
    const existing = compassKeypointByName(current, key);
    if (key === name) {
      return existing
        ? { ...existing, visibility }
        : { name: key, x: points[0]?.x ?? 0, y: points[0]?.y ?? 0, visibility, source: "derived" as const };
    }
    return existing;
  }).filter((item): item is CompassKeypoint => item != null);
  return { ...attributes, keypoints: serializeCompassKeypoints(next) };
}

export function patchCompassKeypointPosition(
  attributes: Record<string, unknown>,
  name: CompassKeypointName,
  x: number,
  y: number,
  points: Pt[],
  headingDeg?: number | null,
  visibility: KeypointVisibility = "visible",
  keepVisibility = false,
): Record<string, unknown> {
  const current = resolveCompassKeypoints(attributes, points, headingDeg);
  const next = COMPASS_KEYPOINT_NAMES.map((key) => {
    const existing = compassKeypointByName(current, key);
    if (key === name) {
      const nextVisibility =
        keepVisibility && existing && existing.visibility !== "not_labeled"
          ? existing.visibility
          : visibility;
      return {
        name: key,
        x,
        y,
        visibility: nextVisibility,
        source: "manual" as const,
      };
    }
    return existing;
  }).filter((item): item is CompassKeypoint => item != null);
  const headingVec = headingVecFromCompassKeypoints(next);
  const heading = headingFromCompassKeypoints(next);
  return {
    ...attributes,
    keypoints: serializeCompassKeypoints(next),
    ...(headingVec ? { headingVec } : {}),
    ...(heading != null ? { headingDeg: heading } : {}),
  };
}
