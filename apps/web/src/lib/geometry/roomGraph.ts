import type { EntityRelationship } from "@highlife/shared-types";
import { overlayGeometryPoints } from "@/features/plan-editor/geometry";
import { adjacencyPadPx } from "@/lib/hierarchy/roomProperties";
import { classifyRoomLabel } from "@/lib/hierarchy/apartmentCharacteristics";
import {
  distToRing,
  type ExtractedGeometryRoom,
  type GeometryInputEntity,
  type Pt,
} from "./wallBoundedRooms";

export type RoomGraphEdgeKind = "shared_wall" | "door" | "window_exterior";

export type RoomGraphEdge = {
  id: string;
  kind: RoomGraphEdgeKind;
  fromId: string;
  toId: string;
  viaId?: string;
  viaLabel?: string;
};

export type RoomGraph = {
  nodes: ExtractedGeometryRoom[];
  edges: RoomGraphEdge[];
};

export type RoomEgo = {
  room: ExtractedGeometryRoom;
  walls: { id: string; label: string }[];
  doors: { id: string; label: string; neighborId: string | null; neighborLabel: string | null }[];
  windows: { id: string; label: string }[];
  habitable: boolean;
  hasExteriorWindow: boolean;
};

function liveOpenings(entities: GeometryInputEntity[]): GeometryInputEntity[] {
  return entities.filter(
    (e) => e.status !== "rejected" && (e.type === "door" || e.type === "window"),
  );
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

function boxesNear(
  a: { x0: number; y0: number; x1: number; y1: number },
  b: { x0: number; y0: number; x1: number; y1: number },
  pad: number,
): boolean {
  return a.x0 < b.x1 + pad && a.x1 + pad > b.x0 && a.y0 < b.y1 + pad && a.y1 + pad > b.y0;
}

function minRingDistance(a: Pt[], b: Pt[]): number {
  let best = Infinity;
  for (const p of a) best = Math.min(best, distToRing(p, b));
  for (const p of b) best = Math.min(best, distToRing(p, a));
  return best;
}

function sameGroup(a: ExtractedGeometryRoom, b: ExtractedGeometryRoom): boolean {
  if (a.isCommon && b.isCommon) return true;
  if (a.unitId && b.unitId && a.unitId === b.unitId) return true;
  if (a.unitLabel && b.unitLabel && a.unitLabel === b.unitLabel) return true;
  return false;
}

/** Bedrooms and living-type rooms that policy treats as needing daylight / ventilation. */
export function isHabitableRoomLabel(label: string): boolean {
  const kind = classifyRoomLabel(label);
  if (kind === "bedroom") return true;
  if (kind === "bathroom" || kind === "toilet" || kind === "balcony" || kind === "courtyard") {
    return false;
  }
  const n = label.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (/\b(store|storage|robe|wardrobe|linen|laundry|closet|corridor|hallway|lobby|stair|lift)\b/.test(n)) {
    return false;
  }
  return /\b(living|lounge|dining|study|family|rumpus|kitchen|open living)\b/.test(n);
}

function roomsNearOpening(
  rooms: ExtractedGeometryRoom[],
  opening: GeometryInputEntity,
  pad: number,
): { room: ExtractedGeometryRoom; dist: number }[] {
  const c = centroidOf(overlayGeometryPoints(opening.geometry));
  const hits: { room: ExtractedGeometryRoom; dist: number }[] = [];
  for (const room of rooms) {
    const d = distToRing(c, room.points);
    if (d <= pad) hits.push({ room, dist: d });
  }
  hits.sort((a, b) => a.dist - b.dist);
  return hits;
}

/**
 * Spatial graph for wall-bounded rooms: shared walls, doors (traversable),
 * and exterior windows. Built per page after Geometry extract.
 */
export function buildRoomGraph(args: {
  rooms: ExtractedGeometryRoom[];
  openings: GeometryInputEntity[];
  pixelsPerMeter?: number | null;
}): RoomGraph {
  const rooms = args.rooms;
  const pad = adjacencyPadPx(args.pixelsPerMeter);
  const edges: RoomGraphEdge[] = [];
  const seen = new Set<string>();
  const push = (edge: RoomGraphEdge) => {
    const key = `${edge.kind}:${[edge.fromId, edge.toId].sort().join(">")}:${edge.viaId ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(edge);
  };

  for (let i = 0; i < rooms.length; i++) {
    const a = rooms[i];
    const ab = bboxOf(a.points);
    if (!ab) continue;
    for (let j = i + 1; j < rooms.length; j++) {
      const b = rooms[j];
      if (!sameGroup(a, b)) continue;
      const bb = bboxOf(b.points);
      if (!bb || !boxesNear(ab, bb, pad)) continue;
      if (minRingDistance(a.points, b.points) > pad) continue;
      push({
        id: `wall-${a.id}-${b.id}`,
        kind: "shared_wall",
        fromId: a.id,
        toId: b.id,
      });
    }
  }

  for (const opening of liveOpenings(args.openings)) {
    const near = roomsNearOpening(rooms, opening, pad);
    if (opening.type === "window") {
      const hit = near[0];
      if (!hit) continue;
      push({
        id: `win-${hit.room.id}-${opening.id}`,
        kind: "window_exterior",
        fromId: hit.room.id,
        toId: opening.id,
        viaId: opening.id,
        viaLabel: opening.label,
      });
      continue;
    }
    const a = near[0];
    const b = near[1];
    if (a && b && sameGroup(a.room, b.room)) {
      push({
        id: `door-${a.room.id}-${b.room.id}-${opening.id}`,
        kind: "door",
        fromId: a.room.id,
        toId: b.room.id,
        viaId: opening.id,
        viaLabel: opening.label,
      });
    } else if (a) {
      push({
        id: `door-${a.room.id}-${opening.id}`,
        kind: "door",
        fromId: a.room.id,
        toId: opening.id,
        viaId: opening.id,
        viaLabel: opening.label,
      });
    }
  }

  return { nodes: rooms, edges };
}

export function egoNeighborhood(graph: RoomGraph, roomId: string): RoomEgo | null {
  const room = graph.nodes.find((n) => n.id === roomId);
  if (!room) return null;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const walls: RoomEgo["walls"] = [];
  const doors: RoomEgo["doors"] = [];
  const windows: RoomEgo["windows"] = [];
  for (const edge of graph.edges) {
    if (edge.kind === "window_exterior" && edge.fromId === roomId) {
      windows.push({ id: edge.viaId ?? edge.toId, label: edge.viaLabel ?? "Window" });
      continue;
    }
    const otherId = edge.fromId === roomId ? edge.toId : edge.toId === roomId ? edge.fromId : null;
    if (!otherId) continue;
    if (edge.kind === "shared_wall") {
      const other = byId.get(otherId);
      walls.push({ id: otherId, label: other?.label ?? "Room" });
    } else if (edge.kind === "door") {
      const other = byId.get(otherId);
      doors.push({
        id: edge.viaId ?? edge.id,
        label: edge.viaLabel ?? "Door",
        neighborId: other ? other.id : null,
        neighborLabel: other?.label ?? (otherId.startsWith("geo-") ? null : edge.viaLabel ?? null),
      });
    }
  }
  return {
    room,
    walls,
    doors,
    windows,
    habitable: isHabitableRoomLabel(room.label),
    hasExteriorWindow: windows.length > 0,
  };
}

export function doorNeighbors(graph: RoomGraph, roomId: string): string[] {
  const out: string[] = [];
  for (const edge of graph.edges) {
    if (edge.kind !== "door") continue;
    if (edge.fromId === roomId && graph.nodes.some((n) => n.id === edge.toId)) out.push(edge.toId);
    if (edge.toId === roomId && graph.nodes.some((n) => n.id === edge.fromId)) out.push(edge.fromId);
  }
  return [...new Set(out)];
}

export function doorPathExists(graph: RoomGraph, fromId: string, toId: string): boolean {
  if (fromId === toId) return true;
  const seen = new Set([fromId]);
  const q = [fromId];
  while (q.length) {
    const cur = q.shift()!;
    for (const n of doorNeighbors(graph, cur)) {
      if (seen.has(n)) continue;
      if (n === toId) return true;
      seen.add(n);
      q.push(n);
    }
  }
  return false;
}

function roomsInUnit(graph: RoomGraph, unitId?: string | null, unitLabel?: string | null): ExtractedGeometryRoom[] {
  return graph.nodes.filter((n) => {
    if (n.isCommon) return false;
    if (unitId && n.unitId === unitId) return true;
    if (unitLabel && n.unitLabel === unitLabel) return true;
    return false;
  });
}

export function unitHasCrossVentPath(
  graph: RoomGraph,
  unitId?: string | null,
  unitLabel?: string | null,
): boolean | null {
  const nodes = roomsInUnit(graph, unitId, unitLabel);
  if (!nodes.length) return null;
  const windowed = nodes.filter((n) =>
    graph.edges.some((e) => e.kind === "window_exterior" && e.fromId === n.id),
  );
  if (windowed.length < 2) return false;
  for (let i = 0; i < windowed.length; i++) {
    for (let j = i + 1; j < windowed.length; j++) {
      if (doorPathExists(graph, windowed[i].id, windowed[j].id)) return true;
    }
  }
  return false;
}

export function habitableMissingWindows(
  graph: RoomGraph,
  unitId?: string | null,
  unitLabel?: string | null,
): ExtractedGeometryRoom[] {
  const nodes =
    unitId || unitLabel ? roomsInUnit(graph, unitId, unitLabel) : graph.nodes.filter((n) => !n.isCommon);
  return nodes.filter((n) => {
    if (!isHabitableRoomLabel(n.label)) return false;
    return !graph.edges.some((e) => e.kind === "window_exterior" && e.fromId === n.id);
  });
}

export function toSceneRelationships(graph: RoomGraph): EntityRelationship[] {
  return graph.edges.map((edge, i) => ({
    id: edge.id || `${edge.kind}-${i}`,
    type:
      edge.kind === "window_exterior"
        ? "room_window_exterior"
        : edge.kind === "door"
          ? "room_door_access"
          : "room_adjacency",
    fromEntityId: edge.fromId,
    toEntityId: edge.toId,
    confidence: 0.85,
    attributes: {
      via: edge.kind,
      viaId: edge.viaId,
      viaLabel: edge.viaLabel,
    },
  }));
}
