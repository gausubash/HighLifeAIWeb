import type { Measurement } from "@highlife/shared-types";
import type { OverlayEntity, OverlayGeometry } from "@/features/plan-editor/types";
import { polygonAreaPx2 } from "@/lib/hierarchy/apartmentCharacteristics";
import { windowLongEdge, type Pt } from "@/lib/hierarchy/apartmentAspect";

export type MetricKind = Measurement["kind"] | "window_long_edge";

export type MetricRow = {
  id: string;
  kind: MetricKind;
  sourceGeometryIds: string[];
  label: string;
  valuePx: number;
  valueMm: number | null;
  valueM: number | null;
  valueM2: number | null;
  unit: string;
  estimated: boolean;
};

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

function perimeterPx(pts: Pt[]): number {
  if (pts.length < 2) return 0;
  let n = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    n += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return n;
}

/** Mean distance between consecutive vertices as a crude thickness for a wall ribbon. */
export function wallThicknessPx(pts: Pt[]): number {
  if (pts.length < 4) return 0;
  const edge = windowLongEdge(pts);
  if (!edge) return 0;
  const len = edge.lengthPx || 1;
  const area = polygonAreaPx2(pts);
  return area > 0 ? area / len : 0;
}

export function minWidthPx(pts: Pt[]): number {
  const b = bbox(pts);
  if (!b) return 0;
  return Math.min(b.x1 - b.x0, b.y1 - b.y0);
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

function scaleRow(
  kind: MetricKind,
  sourceId: string,
  label: string,
  valuePx: number,
  pixelsPerMeter: number | null,
  asArea = false,
): MetricRow {
  const ppm = pixelsPerMeter && pixelsPerMeter > 0 ? pixelsPerMeter : null;
  const valueM = !asArea && ppm ? valuePx / ppm : null;
  const valueMm = valueM != null ? valueM * 1000 : null;
  const valueM2 = asArea && ppm ? valuePx / (ppm * ppm) : null;
  return {
    id: `${kind}-${sourceId}`,
    kind,
    sourceGeometryIds: [sourceId],
    label,
    valuePx,
    valueMm,
    valueM,
    valueM2,
    unit: asArea ? "m2" : "mm",
    estimated: ppm == null,
  };
}

export function computeMetricLayer(
  entities: OverlayEntity[],
  pixelsPerMeter: number | null | undefined,
): MetricRow[] {
  const ppm = pixelsPerMeter ?? null;
  const rows: MetricRow[] = [];
  for (const e of entities) {
    if (e.status === "rejected") continue;
    const pts = pointsOf(e.geometry);
    if (e.type === "room" || e.type === "unit_boundary") {
      const area = polygonAreaPx2(pts);
      if (area > 0) rows.push(scaleRow("room_area", e.id, e.label, area, ppm, true));
      const peri = perimeterPx(pts);
      if (peri > 0) rows.push(scaleRow("room_perimeter", e.id, e.label, peri, ppm));
      const mw = minWidthPx(pts);
      if (mw > 0 && e.type === "room") rows.push(scaleRow("min_room_width", e.id, e.label, mw, ppm));
    }
    if (e.type === "wall") {
      const edge = windowLongEdge(pts);
      if (edge) rows.push(scaleRow("distance", e.id, e.label, edge.lengthPx, ppm));
      const th = wallThicknessPx(pts);
      if (th > 0) rows.push(scaleRow("wall_thickness", e.id, e.label, th, ppm));
    }
    if (e.type === "door" || e.type === "window") {
      const edge = windowLongEdge(pts);
      const longPx = edge?.lengthPx ?? 0;
      if (longPx > 0) {
        rows.push(scaleRow("opening_width", e.id, e.label, longPx, ppm));
        if (e.type === "window") rows.push(scaleRow("window_long_edge", e.id, e.label, longPx, ppm));
      }
    }
  }
  return rows;
}
