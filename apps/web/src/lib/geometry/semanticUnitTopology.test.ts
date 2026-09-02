import { describe, expect, it } from "vitest";
import type { UnitGraph } from "./buildUnitGraph";
import { buildSemanticUnitTopology } from "./semanticUnitTopology";
import { buildRoomGraph } from "./roomGraph";
import type { ExtractedGeometryRoom } from "./wallBoundedRooms";

function room(
  id: string,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
): ExtractedGeometryRoom {
  return {
    id,
    label,
    unitId: "u1",
    unitLabel: "Unit 56",
    isCommon: false,
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    areaPx2: w * h,
    widthPx: w,
    depthPx: h,
    perimeterPx: 2 * (w + h),
    areaM2: null,
    widthM: null,
    depthM: null,
    perimeterM: null,
    adjacentIds: [],
    adjacentLabels: [],
    openings: { doors: [], windows: [] },
  };
}

describe("buildSemanticUnitTopology", () => {
  it("connects apartment type through open living to bedrooms and kitchen", () => {
    const liv = room("liv", "Open Living", 50, 0, 50, 60);
    const bed1 = room("b1", "Bedroom 1", 0, 0, 50, 60);
    const bed2 = room("b2", "Bedroom 2", 100, 0, 50, 60);
    const kit = room("kit", "Kitchen", 50, 60, 50, 40);
    const rooms = [liv, bed1, bed2, kit];

    const roomGraph = buildRoomGraph({
      rooms,
      openings: [
        {
          id: "d1",
          type: "door",
          label: "Door",
          status: "predicted",
          geometry: { kind: "point", x: 50, y: 30 },
        },
        {
          id: "d2",
          type: "door",
          label: "Door",
          status: "predicted",
          geometry: { kind: "point", x: 100, y: 30 },
        },
        {
          id: "d3",
          type: "door",
          label: "Door",
          status: "predicted",
          geometry: { kind: "point", x: 75, y: 60 },
        },
      ],
      pixelsPerMeter: 10,
    });

    const unitGraph: UnitGraph = {
      units: [{ id: "u1", label: "Unit 56", roomIds: rooms.map((r) => r.id), externalWallCount: 0, internalWallCount: 4 }],
      nodes: rooms.map((r) => ({
        id: r.id,
        label: r.label,
        roomKind: "internal",
        unitId: r.unitId,
        unitLabel: r.unitLabel,
        isCommon: false,
        touchesExternal: false,
        centroid: { x: r.points[0].x + r.widthPx / 2, y: r.points[0].y + r.depthPx / 2 },
      })),
      edges: roomGraph.edges.map((e) => ({ ...e, isUnitBoundary: false })),
      wallStats: { external: 0, internal: 0 },
    };

    const topo = buildSemanticUnitTopology({
      unit: unitGraph.units[0],
      unitGraph,
      roomGraph,
      apartmentType: { unitId: "56", apartmentType: "3B", bedroomCount: 3 },
    });

    expect(topo.apartmentType).toBe("3B");
    expect(topo.livingNodeId).toBe("liv");
    expect(topo.detectedBedrooms).toBe(2);
    expect(topo.nodes.some((n) => n.role === "apartment_type")).toBe(true);

    const typeToLiving = topo.edges.find((e) => e.kind === "type_to_hub");
    expect(typeToLiving?.toId).toBe("liv");

    const hubEdges = topo.edges.filter((e) => e.kind === "hub_to_room");
    expect(hubEdges.map((e) => e.toId).sort()).toEqual(["b1", "b2", "kit"].sort());
    expect(hubEdges.some((e) => e.toId === "b1" && e.link === "door")).toBe(true);
  });

  it("uses kitchen as the hub when there is no living room", () => {
    const kit = room("kit", "Kitchen", 0, 0, 80, 80);
    const bed = room("b1", "Bedroom 1", 80, 0, 50, 50);
    const rooms = [kit, bed];
    const roomGraph = buildRoomGraph({ rooms, openings: [], pixelsPerMeter: 10 });
    const unitGraph: UnitGraph = {
      units: [{ id: "u1", label: "Unit 56", roomIds: ["kit", "b1"], externalWallCount: 0, internalWallCount: 2 }],
      nodes: rooms.map((r) => ({
        id: r.id,
        label: r.label,
        roomKind: "internal",
        unitId: "u1",
        unitLabel: "Unit 56",
        isCommon: false,
        touchesExternal: false,
        centroid: { x: r.points[0].x + 20, y: r.points[0].y + 20 },
      })),
      edges: [],
      wallStats: { external: 0, internal: 0 },
    };

    const topo = buildSemanticUnitTopology({
      unit: unitGraph.units[0],
      unitGraph,
      roomGraph,
      apartmentType: { unitId: "56", apartmentType: "1B", bedroomCount: 1 },
    });

    expect(topo.livingNodeId).toBe("kit");
  });

  it("uses dining as the hub when there is no living or kitchen", () => {
    const dining = room("din", "Dining Room", 0, 0, 80, 80);
    const bed = room("b1", "Bedroom 1", 80, 0, 50, 50);
    const rooms = [dining, bed];
    const roomGraph = buildRoomGraph({ rooms, openings: [], pixelsPerMeter: 10 });
    const unitGraph: UnitGraph = {
      units: [{ id: "u1", label: "Unit 56", roomIds: ["din", "b1"], externalWallCount: 0, internalWallCount: 2 }],
      nodes: rooms.map((r) => ({
        id: r.id,
        label: r.label,
        roomKind: "internal",
        unitId: "u1",
        unitLabel: "Unit 56",
        isCommon: false,
        touchesExternal: false,
        centroid: { x: r.points[0].x + 20, y: r.points[0].y + 20 },
      })),
      edges: [],
      wallStats: { external: 0, internal: 0 },
    };

    const topo = buildSemanticUnitTopology({
      unit: unitGraph.units[0],
      unitGraph,
      roomGraph,
      apartmentType: null,
    });

    expect(topo.livingNodeId).toBe("din");
    expect(topo.nodes.find((n) => n.id === "din")?.role).toBe("dining");
  });

  it("prefers living over dining and kitchen when all are present", () => {
    const liv = room("liv", "Open Living", 0, 0, 50, 50);
    const din = room("din", "Dining", 50, 0, 50, 50);
    const kit = room("kit", "Kitchen", 0, 50, 50, 50);
    const rooms = [liv, din, kit];
    const roomGraph = buildRoomGraph({ rooms, openings: [], pixelsPerMeter: 10 });
    const unitGraph: UnitGraph = {
      units: [{ id: "u1", label: "Unit 56", roomIds: rooms.map((r) => r.id), externalWallCount: 0, internalWallCount: 3 }],
      nodes: rooms.map((r) => ({
        id: r.id,
        label: r.label,
        roomKind: "internal",
        unitId: "u1",
        unitLabel: "Unit 56",
        isCommon: false,
        touchesExternal: false,
        centroid: { x: r.points[0].x + 10, y: r.points[0].y + 10 },
      })),
      edges: [],
      wallStats: { external: 0, internal: 0 },
    };

    const topo = buildSemanticUnitTopology({
      unit: unitGraph.units[0],
      unitGraph,
      roomGraph,
      apartmentType: null,
    });

    expect(topo.livingNodeId).toBe("liv");
  });

  it("warns when bedroom count mismatches title type", () => {
    const liv = room("liv", "Open Living", 0, 0, 50, 50);
    const bed = room("b1", "Bedroom 1", 50, 0, 50, 50);
    const rooms = [liv, bed];
    const roomGraph = buildRoomGraph({ rooms, openings: [], pixelsPerMeter: 10 });
    const unitGraph: UnitGraph = {
      units: [{ id: "u1", label: "Unit 56", roomIds: ["liv", "b1"], externalWallCount: 0, internalWallCount: 2 }],
      nodes: rooms.map((r) => ({
        id: r.id,
        label: r.label,
        roomKind: "internal",
        unitId: "u1",
        unitLabel: "Unit 56",
        isCommon: false,
        touchesExternal: false,
        centroid: { x: 25, y: 25 },
      })),
      edges: [],
      wallStats: { external: 0, internal: 0 },
    };

    const topo = buildSemanticUnitTopology({
      unit: unitGraph.units[0],
      unitGraph,
      roomGraph,
      apartmentType: { unitId: "56", apartmentType: "3B", bedroomCount: 3 },
    });

    expect(topo.warnings.some((w) => w.includes("expects 3"))).toBe(true);
  });
});
