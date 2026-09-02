import { describe, expect, it } from "vitest";
import { classifyWallEntity } from "./classifyWallEntities";
import { enrichRoomsWithOcrLabels, extractOcrRoomSeeds, ocrTextToRoomLabel } from "./matchOcrRoomLabels";
import { buildUnitGraph } from "./buildUnitGraph";
import { buildRoomGraph } from "./roomGraph";
import type { ExtractedGeometryRoom } from "./wallBoundedRooms";

describe("ocrTextToRoomLabel", () => {
  it("parses common apartment room OCR", () => {
    expect(ocrTextToRoomLabel("BED 1")).toBe("Bedroom 1");
    expect(ocrTextToRoomLabel("Living / Dining")).toBe("Living / Dining");
    expect(ocrTextToRoomLabel("LIVING")).toBe("Open Living");
    expect(ocrTextToRoomLabel("living")).toBe("Open Living");
    expect(ocrTextToRoomLabel("KITCHEN")).toBe("Kitchen");
    expect(ocrTextToRoomLabel("DINING")).toBe("Dining");
    expect(ocrTextToRoomLabel("LIVING / KITCHEN")).toBe("Living / Kitchen");
    expect(ocrTextToRoomLabel("W.I.R")).toBe("Robe");
  });

  it("ignores apartment type tokens and bedroom counts", () => {
    expect(ocrTextToRoomLabel("3B")).toBeNull();
    expect(ocrTextToRoomLabel("2 BED")).toBeNull();
    expect(ocrTextToRoomLabel("3 BEDROOM")).toBeNull();
    expect(ocrTextToRoomLabel("Type 3B")).toBeNull();
  });

  it("joins CAD letter fragments into LIVING", () => {
    const glyph = (ch: string, x: number): [number, number][] => [
      [x, 40],
      [x + 6, 40],
      [x + 6, 52],
      [x, 52],
    ];
    const seeds = extractOcrRoomSeeds(
      "LIVING".split("").map((ch, i) => ({ text: ch, bbox: glyph(ch, 20 + i * 8) })),
    );
    expect(seeds.some((s) => s.label === "Open Living")).toBe(true);
  });
});

describe("classifyWallEntity", () => {
  it("classifies thick walls as external in thickness mode", () => {
    const wall = classifyWallEntity(
      {
        id: "w1",
        label: "Wall",
        type: "wall",
        geometry: {
          kind: "polygon",
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 30 },
            { x: 0, y: 30 },
          ],
        },
      },
      100,
      150,
      "thickness",
    );
    expect(wall?.classification).toBe("external");
  });
});

describe("buildUnitGraph", () => {
  it("groups rooms by unit and keeps internal edges", () => {
    const rooms: ExtractedGeometryRoom[] = [
      {
        id: "r1",
        label: "Bedroom",
        unitId: "u1",
        unitLabel: "Unit 101",
        isCommon: false,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        areaPx2: 10000,
        widthPx: 100,
        depthPx: 100,
        perimeterPx: 400,
        areaM2: null,
        widthM: null,
        depthM: null,
        perimeterM: null,
        adjacentIds: [],
        adjacentLabels: [],
        openings: { doors: [], windows: [] },
      },
      {
        id: "r2",
        label: "Kitchen",
        unitId: "u1",
        unitLabel: "Unit 101",
        isCommon: false,
        points: [
          { x: 100, y: 0 },
          { x: 200, y: 0 },
          { x: 200, y: 100 },
          { x: 100, y: 100 },
        ],
        areaPx2: 10000,
        widthPx: 100,
        depthPx: 100,
        perimeterPx: 400,
        areaM2: null,
        widthM: null,
        depthM: null,
        perimeterM: null,
        adjacentIds: [],
        adjacentLabels: [],
        openings: { doors: [], windows: [] },
      },
    ];

    const graph = buildRoomGraph({ rooms, openings: [], pixelsPerMeter: 100 });
    const unitGraph = buildUnitGraph({
      rooms,
      roomGraph: graph,
      walls: [],
      wallEntities: [],
      pixelsPerMeter: 100,
    });

    expect(unitGraph.units).toHaveLength(1);
    expect(unitGraph.units[0].label).toBe("Unit 101");
    expect(unitGraph.nodes).toHaveLength(2);
    expect(unitGraph.edges.length).toBeGreaterThanOrEqual(1);
  });
});

describe("enrichRoomsWithOcrLabels", () => {
  it("labels generic rooms from OCR centroids", () => {
    const rooms: ExtractedGeometryRoom[] = [
      {
        id: "r1",
        label: "Room",
        unitId: "u1",
        unitLabel: "Unit 101",
        isCommon: false,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        areaPx2: 10000,
        widthPx: 100,
        depthPx: 100,
        perimeterPx: 400,
        areaM2: null,
        widthM: null,
        depthM: null,
        perimeterM: null,
        adjacentIds: [],
        adjacentLabels: [],
        openings: { doors: [], windows: [] },
      },
    ];

    const enriched = enrichRoomsWithOcrLabels(rooms, [
      { text: "BED 1", bbox: [[50, 50], [60, 50], [60, 60], [50, 60]] },
    ]);
    expect(enriched[0].label).toBe("Bedroom 1");
  });
});
