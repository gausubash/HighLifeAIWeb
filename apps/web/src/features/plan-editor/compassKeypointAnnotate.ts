import { headingFromGeometry } from "@/lib/hierarchy/apartmentAspect";
import {
  compassKeypointRole,
  parseCompassKeypoints,
  patchCompassKeypointPosition,
  resolveCompassKeypoints,
  serializeCompassKeypoints,
  type CompassKeypoint,
  type CompassKeypointName,
  type KeypointVisibility,
} from "@/lib/hierarchy/compassKeypoints";
import { dist2, overlayGeometryPoints } from "./geometry";
import { ENTITY_LAYER, type OverlayEntity } from "./types";
import type { Point } from "@highlife/shared-types";

export function isNorthArrowLabel(label?: string): boolean {
  const n = (label ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  return n === "north" || n === "compass" || n === "north arrow" || n.startsWith("north arrow");
}

export function isNorthArrowEntity(entity: { type?: string; label?: string }): boolean {
  const type = (entity.type ?? "").trim().toLowerCase();
  if (type === "north_arrow") return true;
  return isNorthArrowLabel(entity.label);
}

export function asNorthArrowEntity(entity: OverlayEntity): OverlayEntity {
  if (entity.type === "north_arrow" && entity.layer === ENTITY_LAYER.north_arrow) return entity;
  return {
    ...entity,
    type: "north_arrow",
    layer: ENTITY_LAYER.north_arrow,
  };
}

export function isCompassKeypointLabel(label: string): CompassKeypointName | null {
  return compassKeypointRole(label, 0, 1);
}

export function northArrowKeypoints(entity: OverlayEntity): CompassKeypoint[] {
  const points = overlayGeometryPoints(entity.geometry);
  const heading = headingFromGeometry(points, entity.attributes);
  return resolveCompassKeypoints(entity.attributes, points, heading);
}

export function stampNorthArrowKeypoints(entity: OverlayEntity): OverlayEntity {
  if (!isNorthArrowEntity(entity)) return entity;
  const keypoints = northArrowKeypoints(entity);
  if (!keypoints.length) return entity;
  return {
    ...entity,
    attributes: {
      ...entity.attributes,
      keypoints: serializeCompassKeypoints(keypoints),
    },
  };
}

export function placeCompassKeypointOnEntity(
  entity: OverlayEntity,
  name: CompassKeypointName,
  pt: Point,
  visibility: KeypointVisibility = "visible",
  keepVisibility = false,
): OverlayEntity {
  const points = overlayGeometryPoints(entity.geometry);
  const heading = headingFromGeometry(points, entity.attributes);
  return asNorthArrowEntity({
    ...entity,
    attributes: patchCompassKeypointPosition(
      entity.attributes,
      name,
      pt.x,
      pt.y,
      points,
      heading,
      visibility,
      keepVisibility,
    ),
    updatedAt: new Date().toISOString(),
  });
}

export function hitTestCompassKeypoint(
  pt: Point,
  entities: OverlayEntity[],
  tolerance: number,
  preferIds: string[] = [],
): { entityId: string; name: CompassKeypointName } | null {
  const radius2 = tolerance * tolerance * 4;
  let best: { entityId: string; name: CompassKeypointName; d2: number; preferred: boolean } | null = null;
  const prefer = new Set(preferIds);
  for (const entity of entities) {
    if (!isNorthArrowEntity(entity)) continue;
    for (const keypoint of northArrowKeypoints(entity)) {
      if (keypoint.visibility === "not_labeled") continue;
      const d2 = dist2(pt, keypoint);
      const preferred = prefer.has(entity.id);
      if (d2 > radius2) continue;
      if (
        !best ||
        (preferred && !best.preferred) ||
        (preferred === best.preferred && d2 < best.d2)
      ) {
        best = { entityId: entity.id, name: keypoint.name, d2, preferred };
      }
    }
  }
  return best ? { entityId: best.entityId, name: best.name } : null;
}

export function attachKeypointsFromFlags(
  entity: OverlayEntity,
  flags: Record<string, unknown> | undefined,
): OverlayEntity {
  if (!flags) return entity;
  const parsed = parseCompassKeypoints(flags);
  if (!parsed.length) return entity;
  return {
    ...entity,
    attributes: {
      ...entity.attributes,
      keypoints: serializeCompassKeypoints(parsed),
    },
  };
}

export function mergeSiblingCompassPoints(
  entities: OverlayEntity[],
  points: Array<{
    name: CompassKeypointName;
    x: number;
    y: number;
    visibility?: KeypointVisibility;
    groupId?: number | null;
  }>,
): OverlayEntity[] {
  if (!points.length) return entities;
  const north = entities.filter(isNorthArrowEntity);
  if (!north.length) return entities;
  let next = entities;
  for (const point of points) {
    const grouped =
      point.groupId != null
        ? north.find((entity) => entity.attributes.groupId === point.groupId)
        : null;
    const target =
      grouped ??
      north.reduce((best, entity) => {
        const c = centroidOf(entity);
        const d = dist2(c, point);
        const bestD = dist2(centroidOf(best), point);
        return d < bestD ? entity : best;
      });
    next = next.map((entity) =>
      entity.id === target.id
        ? placeCompassKeypointOnEntity(entity, point.name, point, point.visibility ?? "visible")
        : entity,
    );
  }
  return next;
}

function centroidOf(entity: OverlayEntity): Point {
  const pts = overlayGeometryPoints(entity.geometry);
  if (!pts.length) return { x: 0, y: 0 };
  const sum = pts.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / pts.length, y: sum.y / pts.length };
}
