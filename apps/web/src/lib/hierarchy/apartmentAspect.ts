import { headingFromCompassKeypoints, parseCompassKeypoints } from "./compassKeypoints";

export type Pt = { x: number; y: number };

export type WindowLongEdge = {
  start: Pt;
  end: Pt;
  lengthPx: number;
  midpoint: Pt;
  axis: Pt;
};

/** Longest edge of a polygon (wall-parallel window length). */
export function windowLongEdge(points: Pt[]): WindowLongEdge | null {
  if (points.length < 2) return null;
  let best: WindowLongEdge | null = null;
  const n = points.length;
  const closed = n >= 3;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthPx = Math.hypot(dx, dy);
    if (!best || lengthPx > best.lengthPx) {
      best = {
        start: a,
        end: b,
        lengthPx,
        midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        axis: { x: dx, y: dy },
      };
    }
  }
  return best && best.lengthPx > 1e-6 ? best : null;
}

/** Rotate 90° and flip so the normal points away from `inside`. */
export function outwardPerpendicular(axis: Pt, from: Pt, inside: Pt): Pt {
  let nx = -axis.y;
  let ny = axis.x;
  const len = Math.hypot(nx, ny) || 1;
  nx /= len;
  ny /= len;
  const toInside = { x: inside.x - from.x, y: inside.y - from.y };
  if (nx * toInside.x + ny * toInside.y > 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: nx, y: ny };
}

/** Angle of a unit vector: 0 = +X, CCW degrees. */
export function headingDeg(vec: Pt): number {
  return ((Math.atan2(vec.y, vec.x) * 180) / Math.PI + 360) % 360;
}

/**
 * Bearing of an outward normal relative to north heading.
 * 0° = facing north, 90° = east (clockwise compass).
 */
export function bearingFromNorth(outward: Pt, northHeadingDeg: number): number {
  const face = headingDeg(outward);
  const north = ((northHeadingDeg % 360) + 360) % 360;
  return (north - face + 360) % 360;
}

export function cardinalFromBearing(deg: number): "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" {
  const t = ((deg % 360) + 360) % 360;
  const idx = Math.round(t / 45) % 8;
  return (["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const)[idx];
}

/** Heading from stored attributes, compass keypoints, or the long axis of the north-arrow polygon. */
export function headingFromGeometry(
  points: Pt[],
  attributes?: Record<string, unknown> | null,
): number | null {
  const raw = attributes?.headingDeg;
  if (typeof raw === "number" && Number.isFinite(raw)) return ((raw % 360) + 360) % 360;
  const vec = attributes?.headingVec;
  if (vec && typeof vec === "object" && "x" in vec && "y" in vec) {
    const x = Number((vec as { x: unknown }).x);
    const y = Number((vec as { y: unknown }).y);
    if (Number.isFinite(x) && Number.isFinite(y) && (x !== 0 || y !== 0)) return headingDeg({ x, y });
  }
  const fromKeypoints = headingFromCompassKeypoints(parseCompassKeypoints(attributes));
  if (fromKeypoints != null) return fromKeypoints;
  const edge = windowLongEdge(points);
  if (!edge) return null;
  return headingDeg(edge.axis);
}

export function angleDeltaDeg(a: number, b: number): number {
  const d = Math.abs(((a - b + 540) % 360) - 180);
  return d;
}

/** Two facings are opposite (~180°) or perpendicular (~90°). */
export function isOppositeOrPerpendicular(aDeg: number, bDeg: number, tol = 30): boolean {
  const d = angleDeltaDeg(aDeg, bDeg);
  return Math.abs(d - 90) <= tol || Math.abs(d - 180) <= tol;
}
