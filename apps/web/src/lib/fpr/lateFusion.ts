import type { EntityRelationship, FloorPlanSceneGraph, RelationshipType } from "@highlife/shared-types";
import type { OverlayEntity, OverlayGeometry } from "@/features/plan-editor/types";
import { computeMetricLayer } from "./metricLayer";
import { headingFromGeometry } from "@/lib/hierarchy/apartmentAspect";

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
  return [];
}

function centroid(pts: Pt[]): Pt | null {
  if (!pts.length) return null;
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

function pointInPoly(px: number, py: number, poly: Pt[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function rel(
  type: RelationshipType,
  from: string,
  to: string,
  i: number,
): EntityRelationship {
  return {
    id: `${type}-${i}-${from}-${to}`,
    type,
    fromEntityId: from,
    toEntityId: to,
    confidence: 0.7,
    attributes: {},
  };
}

/** Late-fuse specialist overlays into the canonical scene graph (no VLM, no new geometry). */
export function buildLateFusionGraph(args: {
  analysisId: string;
  projectId: string;
  pageId: string;
  entities: OverlayEntity[];
  pixelsPerMeter?: number | null;
}): FloorPlanSceneGraph {
  const now = new Date().toISOString();
  const live = args.entities.filter((e) => e.status !== "rejected");
  const rooms = live.filter((e) => e.type === "room");
  const units = live.filter((e) => e.type === "unit_boundary");
  const doors = live.filter((e) => e.type === "door");
  const windows = live.filter((e) => e.type === "window");
  const fixtures = live.filter((e) => e.type === "fixture");
  const relationships: EntityRelationship[] = [];
  let n = 0;

  const unitPolys = units.map((u) => ({ id: u.id, pts: pointsOf(u.geometry) }));
  for (const room of rooms) {
    const c = centroid(pointsOf(room.geometry));
    if (!c) continue;
    const unit = unitPolys.find((u) => u.pts.length >= 3 && pointInPoly(c.x, c.y, u.pts));
    if (unit) relationships.push(rel("unit_contains_room", unit.id, room.id, n++));
  }

  const roomPolys = rooms.map((r) => ({ id: r.id, pts: pointsOf(r.geometry) }));
  for (const door of doors) {
    const c = centroid(pointsOf(door.geometry));
    if (!c) continue;
    const hits = roomPolys.filter((r) => r.pts.length >= 3 && pointInPoly(c.x, c.y, r.pts));
    for (const hit of hits) relationships.push(rel("room_door_access", hit.id, door.id, n++));
  }
  for (const win of windows) {
    const c = centroid(pointsOf(win.geometry));
    if (!c) continue;
    const hits = roomPolys.filter((r) => r.pts.length >= 3 && pointInPoly(c.x, c.y, r.pts));
    for (const hit of hits) relationships.push(rel("room_window_exterior", hit.id, win.id, n++));
  }
  for (const fix of fixtures) {
    const c = centroid(pointsOf(fix.geometry));
    if (!c) continue;
    const hit = roomPolys.find((r) => r.pts.length >= 3 && pointInPoly(c.x, c.y, r.pts));
    if (hit) relationships.push(rel("room_contains_fixture", hit.id, fix.id, n++));
  }

  const ppm = args.pixelsPerMeter;
  const mmPerPixel = ppm && ppm > 0 ? 1000 / ppm : 0;
  const metrics = computeMetricLayer(live, ppm ?? null);

  return {
    schemaVersion: "1.0.0",
    id: `graph-${args.analysisId}-${args.pageId}`,
    projectId: args.projectId,
    planDocumentId: args.pageId,
    pageId: args.pageId,
    analysisRunId: args.analysisId,
    coordinateSystems: ppm ? ["original_image_px", "world_mm"] : ["original_image_px"],
    workingToOriginal: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 },
    calibration:
      mmPerPixel > 0
        ? {
            id: `cal-${args.pageId}`,
            method: "title_block_scale",
            mmPerPixel,
            confidence: 0.8,
            sourceText: null,
            sourceGeometryPx: null,
            verifiedByUser: false,
            active: true,
            createdAt: now,
          }
        : null,
    entities: live.map((e) => {
      const heading = e.type === "north_arrow" ? headingFromGeometry(pointsOf(e.geometry), e.attributes) : null;
      return {
        id: e.id,
        type: e.type,
        polygonPx: pointsOf(e.geometry),
        attributes: {
          ...e.attributes,
          label: e.label,
          ...(heading != null ? { headingDeg: heading } : {}),
        },
        confidence: e.confidence,
        status: e.status,
        evidence: [],
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      };
    }),
    relationships,
    measurements: metrics.map((m) => ({
      id: m.id,
      kind: m.kind,
      sourceGeometryIds: m.sourceGeometryIds,
      calibrationId: mmPerPixel > 0 ? `cal-${args.pageId}` : "",
      valuePx: m.valuePx,
      valueMm: m.valueMm ?? undefined,
      valueM: m.valueM ?? undefined,
      valueM2: m.valueM2 ?? undefined,
      unit: m.unit,
      precision: 2,
      confidence: m.estimated ? 0.4 : 0.85,
      estimated: m.estimated,
    })),
    createdAt: now,
    updatedAt: now,
  };
}
