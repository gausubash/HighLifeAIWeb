import { overlayGeometryPoints, pointInPolygon } from "@/features/plan-editor/geometry";
import { canonicalLabel, isKnownAnnotateClass, isUnitOutlineEntity } from "@/features/plan-editor/labelClasses";
import type { OverlayEntity } from "@/features/plan-editor/types";
import type { ExtractedGeometryRoom, Pt } from "./wallBoundedRooms";

function genericRoomLabel(label: string): boolean {
  const n = label.trim().toLowerCase();
  return n === "room" || n === "space" || n === "area" || n.startsWith("room ") || n === "corridor";
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

function overlapArea(a: Pt[], b: Pt[]): number {
  const ca = centroidOf(a);
  const cb = centroidOf(b);
  const aInB = pointInPolygon({ x: ca.x, y: ca.y }, b.map((p) => ({ x: p.x, y: p.y })));
  const bInA = pointInPolygon({ x: cb.x, y: cb.y }, a.map((p) => ({ x: p.x, y: p.y })));
  if (aInB || bInA) return Math.min(polyArea(a), polyArea(b));
  return 0;
}

/**
 * Apply YOLO / detect room-type labels to flood-filled rooms when still generic.
 * OCR merge runs after this and can refine labels from drawing text.
 */
export function mergeDetectedRoomLabels(
  rooms: ExtractedGeometryRoom[],
  entities: Pick<OverlayEntity, "id" | "type" | "label" | "geometry" | "status">[],
): ExtractedGeometryRoom[] {
  const detected = entities.filter(
    (e) =>
      e.status !== "rejected" &&
      e.type === "room" &&
      isKnownAnnotateClass(e.label) &&
      !isUnitOutlineEntity(e),
  );
  if (!detected.length) return rooms;

  const detectedRooms = detected.map((entity) => {
    const points = overlayGeometryPoints(entity.geometry).map((p) => ({ x: p.x, y: p.y }));
    return {
      label: canonicalLabel(entity.label) ?? entity.label.trim(),
      points,
      centroid: centroidOf(points),
    };
  });

  return rooms.map((room) => {
    if (!genericRoomLabel(room.label)) return room;

    let bestLabel: string | null = null;
    let bestScore = 0;

    for (const det of detectedRooms) {
      if (det.points.length < 3) continue;
      const overlap = overlapArea(room.points, det.points);
      const rc = centroidOf(room.points);
      const detInRoom = pointInPolygon(
        { x: det.centroid.x, y: det.centroid.y },
        room.points.map((p) => ({ x: p.x, y: p.y })),
      );
      const roomInDet = pointInPolygon(
        { x: rc.x, y: rc.y },
        det.points.map((p) => ({ x: p.x, y: p.y })),
      );
      const d = Math.hypot(rc.x - det.centroid.x, rc.y - det.centroid.y);
      const score = overlap > 0 ? overlap : detInRoom ? Math.max(1, 10000 - d) : roomInDet ? Math.max(1, 5000 - d) : 0;
      if (score <= bestScore) continue;
      bestScore = score;
      bestLabel = det.label;
    }

    if (!bestLabel || bestScore <= 0) return room;
    return { ...room, label: bestLabel };
  });
}
