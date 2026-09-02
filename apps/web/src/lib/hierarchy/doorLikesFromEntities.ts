import { overlayGeometryPoints } from "@/features/plan-editor/geometry";
import type { OverlayEntity } from "@/features/plan-editor/types";
import {
  doorOpeningSpanFromPoints,
  doorOpeningSpanFromRect,
  type DoorLike,
} from "./communalMainDoor";

type Pt = { x: number; y: number };

function centroidOf(points: Pt[]): Pt | null {
  if (!points.length) return null;
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

/** Build door spans from detected / segmented door overlay entities. */
export function doorLikesFromEntities(entities: Iterable<OverlayEntity>): DoorLike[] {
  const out: DoorLike[] = [];
  for (const entity of entities) {
    if (entity.type !== "door" || entity.status === "rejected") continue;
    const points = overlayGeometryPoints(entity.geometry);
    const centroid = centroidOf(points);
    if (!centroid) continue;
    const spanPx =
      entity.geometry.kind === "rect"
        ? doorOpeningSpanFromRect(entity.geometry.width, entity.geometry.height)
        : doorOpeningSpanFromPoints(points);
    out.push({
      id: entity.id,
      label: entity.label,
      centroid,
      spanPx,
    });
  }
  return out;
}
