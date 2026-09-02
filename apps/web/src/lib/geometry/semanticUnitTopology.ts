import type { ApartmentTypeHit } from "@/lib/hierarchy/apartmentType";
import { matchApartmentType } from "@/lib/hierarchy/apartmentType";
import { canonicalLabel } from "@/features/plan-editor/labelClasses";
import { ocrRoomCategoryFromLabel, type OcrRoomCategory } from "./ocrSpatialRooms";
import { isOpenPlanLabel, openPlanKindsFromText } from "./openPlanRoom";
import type { RoomGraph } from "./roomGraph";
import { doorPathExists } from "./roomGraph";
import type { UnitGraph, UnitGraphGroup } from "./buildUnitGraph";
import type { Pt } from "./wallBoundedRooms";

export type SemanticRoomRole =
  | "apartment_type"
  | "living"
  | "bedroom"
  | "kitchen"
  | "bathroom"
  | "dining"
  | "robe"
  | "other";

export type SemanticLinkKind = "door" | "shared_wall" | "inferred";

export type SemanticTopologyNode = {
  id: string;
  label: string;
  role: SemanticRoomRole;
  /** Underlying unit-graph room id when this node is a real room polygon. */
  roomNodeId?: string;
  centroid: Pt;
  expectedBedroom?: boolean;
};

export type SemanticTopologyEdge = {
  id: string;
  fromId: string;
  toId: string;
  kind: "type_to_hub" | "hub_to_room" | "type_to_room";
  link: SemanticLinkKind;
};

export type SemanticUnitTopology = {
  unitId: string;
  unitLabel: string;
  apartmentType: string | null;
  expectedBedrooms: number | null;
  detectedBedrooms: number;
  livingNodeId: string | null;
  nodes: SemanticTopologyNode[];
  edges: SemanticTopologyEdge[];
  warnings: string[];
};

function categoryToRole(category: OcrRoomCategory): SemanticRoomRole {
  if (category === "living") return "living";
  if (category === "bedroom") return "bedroom";
  if (category === "kitchen") return "kitchen";
  if (category === "bathroom") return "bathroom";
  if (category === "dining") return "dining";
  if (category === "robe") return "robe";
  return "other";
}

function semanticRoleFromLabel(label: string, roomKind?: string): SemanticRoomRole {
  const canonical = canonicalLabel(label);
  if (canonical === "Open Living") return "living";

  const kinds = openPlanKindsFromText(label);
  if (kinds.length >= 2 || kinds.includes("living")) return "living";
  const fromText = categoryToRole(ocrRoomCategoryFromLabel(label));
  if (fromText !== "other") return fromText;
  if (isOpenPlanLabel(label)) return "living";
  if (roomKind === "bedroom") return "bedroom";
  if (roomKind === "bathroom" || roomKind === "toilet") return "bathroom";
  return "other";
}

/** Prefer living, then dining, then kitchen as the unit graph hub. */
function hubScore(label: string, role: SemanticRoomRole): number {
  const kinds = openPlanKindsFromText(label);
  if (kinds.length >= 2) return 40 + kinds.length;
  if (kinds.includes("living") || role === "living") return 30;
  if (kinds.includes("dining") || role === "dining") return 20;
  if (kinds.includes("kitchen") || role === "kitchen") return 10;
  return 0;
}

function doorDegree(roomGraph: RoomGraph, roomId: string): number {
  return roomGraph.edges.filter(
    (e) => e.kind === "door" && (e.fromId === roomId || e.toId === roomId),
  ).length;
}

function pickHubNode(
  roomTopologyNodes: SemanticTopologyNode[],
  roomGraph: RoomGraph,
): SemanticTopologyNode | null {
  const candidates = roomTopologyNodes.filter((n) => hubScore(n.label, n.role) > 0);
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const scoreDiff = hubScore(b.label, b.role) - hubScore(a.label, a.role);
    if (scoreDiff !== 0) return scoreDiff;
    return doorDegree(roomGraph, b.id) - doorDegree(roomGraph, a.id);
  });
  return candidates[0];
}

function linkBetweenRooms(
  roomGraph: RoomGraph,
  fromRoomId: string,
  toRoomId: string,
): SemanticLinkKind {
  const directDoor = roomGraph.edges.some(
    (e) =>
      e.kind === "door" &&
      ((e.fromId === fromRoomId && e.toId === toRoomId) ||
        (e.fromId === toRoomId && e.toId === fromRoomId)),
  );
  if (directDoor) return "door";

  const directWall = roomGraph.edges.some(
    (e) =>
      e.kind === "shared_wall" &&
      ((e.fromId === fromRoomId && e.toId === toRoomId) ||
        (e.fromId === toRoomId && e.toId === fromRoomId)),
  );
  if (directWall) return "shared_wall";

  if (doorPathExists(roomGraph, fromRoomId, toRoomId)) return "door";
  return "inferred";
}

function unitCentroid(nodes: SemanticTopologyNode[]): Pt {
  if (!nodes.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const n of nodes) {
    x += n.centroid.x;
    y += n.centroid.y;
  }
  return { x: x / nodes.length, y: y / nodes.length };
}

/**
 * Build a hub topology for one unit: apartment type → living / dining / kitchen hub → other rooms.
 * Spatial door and wall links are preferred; inferred edges fill gaps when geometry is incomplete.
 */
export function buildSemanticUnitTopology(args: {
  unit: UnitGraphGroup;
  unitGraph: UnitGraph;
  roomGraph: RoomGraph;
  apartmentType: ApartmentTypeHit | null;
}): SemanticUnitTopology {
  const { unit, unitGraph, roomGraph, apartmentType } = args;
  const roomNodes = unitGraph.nodes.filter((n) => unit.roomIds.includes(n.id));

  const roomTopologyNodes: SemanticTopologyNode[] = roomNodes.map((n) => ({
    id: n.id,
    label: n.label,
    role: semanticRoleFromLabel(n.label, n.roomKind),
    roomNodeId: n.id,
    centroid: n.centroid,
  }));

  const livingNode = pickHubNode(roomTopologyNodes, roomGraph);

  const hubId = livingNode?.id ?? null;
  const satellites = roomTopologyNodes.filter((n) => n.id !== hubId);

  const nodes: SemanticTopologyNode[] = [...roomTopologyNodes];
  const edges: SemanticTopologyEdge[] = [];
  const warnings: string[] = [];

  const typeNodeId = `semantic-type-${unit.id}`;
  if (apartmentType) {
    const c = unitCentroid(roomTopologyNodes);
    nodes.unshift({
      id: typeNodeId,
      label: apartmentType.apartmentType,
      role: "apartment_type",
      centroid: { x: c.x, y: c.y - 80 },
    });
  }

  const detectedBedrooms = roomTopologyNodes.filter((n) => n.role === "bedroom").length;
  const expectedBedrooms = apartmentType?.bedroomCount ?? null;

  if (expectedBedrooms != null && detectedBedrooms > 0 && expectedBedrooms !== detectedBedrooms) {
    warnings.push(
      `OCR type ${apartmentType!.apartmentType} expects ${expectedBedrooms} bedroom${expectedBedrooms === 1 ? "" : "s"}; found ${detectedBedrooms} from detection/OCR labels.`,
    );
  }

  if (!hubId && satellites.length > 0) {
    warnings.push(
      "No living, dining, or kitchen room — set hub labels on the plan or use the Graph tab after OCR.",
    );
  }

  const connectHub = (fromId: string, toRoomId: string, kind: SemanticTopologyEdge["kind"]) => {
    const link = linkBetweenRooms(roomGraph, fromId, toRoomId);
    edges.push({
      id: `sem-${fromId}-${toRoomId}`,
      fromId,
      toId: toRoomId,
      kind,
      link,
    });
  };

  if (apartmentType) {
    if (hubId) {
      connectHub(typeNodeId, hubId, "type_to_hub");
    } else {
      for (const sat of satellites) {
        connectHub(typeNodeId, sat.id, "type_to_room");
      }
    }
  }

  if (hubId) {
    for (const sat of satellites) {
      connectHub(hubId, sat.id, "hub_to_room");
    }
  }

  return {
    unitId: unit.id,
    unitLabel: unit.label,
    apartmentType: apartmentType?.apartmentType ?? null,
    expectedBedrooms,
    detectedBedrooms,
    livingNodeId: hubId,
    nodes,
    edges,
    warnings,
  };
}

export function buildAllSemanticTopologies(args: {
  unitGraph: UnitGraph;
  roomGraph: RoomGraph;
  typeHits: ApartmentTypeHit[];
}): SemanticUnitTopology[] {
  const { unitGraph, roomGraph, typeHits } = args;

  return unitGraph.units.map((unit) => {
    const hit = matchApartmentType(unit.label, typeHits, unitGraph.units.length);
    return buildSemanticUnitTopology({
      unit,
      unitGraph,
      roomGraph,
      apartmentType: hit,
    });
  });
}
