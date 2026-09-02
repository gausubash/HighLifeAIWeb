import { overlayGeometryPoints } from "@/features/plan-editor/geometry";
import type { OverlayEntity } from "@/features/plan-editor/types";
import { classifyRoomLabel } from "@/lib/hierarchy/apartmentCharacteristics";
import type { ClassifiedWall } from "./classifyWallEntities";
import type { RoomGraph, RoomGraphEdge } from "./roomGraph";
import { distToRing, type ExtractedGeometryRoom, type Pt } from "./wallBoundedRooms";

export type UnitGraphNode = {
  id: string;
  label: string;
  roomKind: string;
  unitId: string | null;
  unitLabel: string | null;
  isCommon: boolean;
  touchesExternal: boolean;
  centroid: Pt;
};

export type UnitGraphEdge = {
  id: string;
  fromId: string;
  toId: string;
  kind: RoomGraphEdge["kind"];
  viaLabel?: string;
  /** True when rooms are in different units or separated by external walls. */
  isUnitBoundary: boolean;
};

export type UnitGraphGroup = {
  id: string;
  label: string;
  roomIds: string[];
  externalWallCount: number;
  internalWallCount: number;
};

export type UnitGraph = {
  units: UnitGraphGroup[];
  nodes: UnitGraphNode[];
  edges: UnitGraphEdge[];
  wallStats: { external: number; internal: number };
};

function centroid(pts: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  const n = Math.max(1, pts.length);
  return { x: x / n, y: y / n };
}

function sameUnit(a: ExtractedGeometryRoom, b: ExtractedGeometryRoom): boolean {
  if (a.isCommon && b.isCommon) return true;
  if (a.isCommon || b.isCommon) return false;
  if (a.unitId && b.unitId) return a.unitId === b.unitId;
  if (a.unitLabel && b.unitLabel) return a.unitLabel === b.unitLabel;
  return false;
}

function roomTouchesExternalWall(
  room: ExtractedGeometryRoom,
  externalWalls: ClassifiedWall[],
  wallGeometries: Map<string, Pt[]>,
  padPx: number,
): boolean {
  const c = centroid(room.points);
  for (const wall of externalWalls) {
    const pts = wallGeometries.get(wall.id);
    if (!pts?.length) continue;
    if (distToRing(c, pts) <= padPx) return true;
  }
  return false;
}

/**
 * Build per-unit adjacency graphs from wall-bounded rooms, OCR labels, and classified walls.
 */
export function buildUnitGraph(args: {
  rooms: ExtractedGeometryRoom[];
  roomGraph: RoomGraph;
  walls: ClassifiedWall[];
  wallEntities: OverlayEntity[];
  pixelsPerMeter?: number | null;
}): UnitGraph {
  const { rooms, roomGraph, walls, wallEntities } = args;
  const pad = args.pixelsPerMeter && args.pixelsPerMeter > 0 ? args.pixelsPerMeter * 0.15 : 24;

  const wallGeometries = new Map<string, Pt[]>();
  for (const e of wallEntities) {
    if (e.type !== "wall" || e.status === "rejected") continue;
    wallGeometries.set(e.id, overlayGeometryPoints(e.geometry));
  }

  const externalWalls = walls.filter((w) => w.classification === "external");
  const internalWalls = walls.filter((w) => w.classification === "internal");

  const roomById = new Map(rooms.map((r) => [r.id, r]));

  const nodes: UnitGraphNode[] = rooms.map((room) => ({
    id: room.id,
    label: room.label,
    roomKind: classifyRoomLabel(room.label),
    unitId: room.unitId,
    unitLabel: room.unitLabel,
    isCommon: room.isCommon,
    touchesExternal: roomTouchesExternalWall(room, externalWalls, wallGeometries, pad),
    centroid: centroid(room.points),
  }));

  const edges: UnitGraphEdge[] = roomGraph.edges.map((edge) => {
    const a = roomById.get(edge.fromId);
    const b = roomById.get(edge.toId);
    const crossUnit = a && b ? !sameUnit(a, b) : false;
    const boundary =
      crossUnit ||
      Boolean(a?.isCommon !== b?.isCommon) ||
      Boolean(a && roomTouchesExternalWall(a, externalWalls, wallGeometries, pad)) ||
      Boolean(b && roomTouchesExternalWall(b, externalWalls, wallGeometries, pad));

    return {
      id: edge.id,
      fromId: edge.fromId,
      toId: edge.toId,
      kind: edge.kind,
      viaLabel: edge.viaLabel,
      isUnitBoundary: boundary && edge.kind === "shared_wall",
    };
  });

  const unitMap = new Map<string, UnitGraphGroup>();
  for (const node of nodes) {
    if (node.isCommon) continue;
    const key = node.unitId ?? node.unitLabel ?? "unassigned";
    const label = node.unitLabel ?? node.unitId ?? "Unassigned";
    const group = unitMap.get(key) ?? {
      id: key,
      label,
      roomIds: [],
      externalWallCount: 0,
      internalWallCount: 0,
    };
    group.roomIds.push(node.id);
    if (node.touchesExternal) group.externalWallCount += 1;
    unitMap.set(key, group);
  }

  for (const group of unitMap.values()) {
    group.internalWallCount = group.roomIds.length;
  }

  const units = [...unitMap.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));

  return {
    units,
    nodes,
    edges: edges.filter((e) => {
      const a = roomById.get(e.fromId);
      const b = roomById.get(e.toId);
      return a && b && sameUnit(a, b);
    }),
    wallStats: { external: externalWalls.length, internal: internalWalls.length },
  };
}
