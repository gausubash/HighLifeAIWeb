import type { Point } from "@highlife/shared-types";
import type { OverlayEntity, OverlayGeometry } from "./types";
import { geometryBBox } from "./types";

export function dist2(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function pointInRect(pt: Point, x: number, y: number, w: number, h: number): boolean {
  const minX = Math.min(x, x + w);
  const maxX = Math.max(x, x + w);
  const minY = Math.min(y, y + h);
  const maxY = Math.max(y, y + h);
  return pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY;
}

export function pointInPolygon(pt: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distToSegment(pt: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.sqrt(dist2(pt, a));
  let t = ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy));
}

export function distToPolyline(pt: Point, points: Point[], closed = false): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return Math.sqrt(dist2(pt, points[0]));
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    best = Math.min(best, distToSegment(pt, points[i], points[i + 1]));
  }
  if (closed && points.length > 2) {
    best = Math.min(best, distToSegment(pt, points[points.length - 1], points[0]));
  }
  return best;
}

export function hitTestGeometry(pt: Point, geometry: OverlayGeometry, tolerance: number): boolean {
  switch (geometry.kind) {
    case "rect":
      return pointInRect(pt, geometry.x, geometry.y, geometry.width, geometry.height);
    case "polygon":
      return pointInPolygon(pt, geometry.points) || distToPolyline(pt, geometry.points, true) <= tolerance;
    case "mask":
      return pointInPolygon(pt, geometry.points) || distToPolyline(pt, geometry.points, true) <= tolerance;
    case "polyline":
      return distToPolyline(pt, geometry.points, Boolean(geometry.closed)) <= tolerance;
    case "point":
      return Math.hypot(pt.x - geometry.x, pt.y - geometry.y) <= Math.max(tolerance, 8);
    default:
      return false;
  }
}

export function hitTestEntities(
  pt: Point,
  entities: OverlayEntity[],
  tolerance: number,
): OverlayEntity | null {
  for (let i = entities.length - 1; i >= 0; i--) {
    if (hitTestGeometry(pt, entities[i].geometry, tolerance)) {
      return entities[i];
    }
  }
  return null;
}

export function normalizeRect(x0: number, y0: number, x1: number, y1: number) {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return { kind: "rect" as const, x, y, width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

export function entityAreaHint(entity: OverlayEntity): string | null {
  const b = geometryBBox(entity.geometry);
  if (entity.geometry.kind === "point") {
    return `${entity.geometry.x.toFixed(0)}, ${entity.geometry.y.toFixed(0)} px`;
  }
  if (b.width <= 0 && b.height <= 0) return null;
  if (entity.geometry.kind === "polyline") {
    let len = 0;
    const pts = entity.geometry.points;
    for (let i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    return `${len.toFixed(0)} px`;
  }
  return `${b.width.toFixed(0)} × ${b.height.toFixed(0)} px`;
}
