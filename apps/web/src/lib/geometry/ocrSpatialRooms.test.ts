import { describe, expect, it } from "vitest";
import {
  assignOcrSeedsToUnits,
  buildSpatialOcrRooms,
  dedupePerUnitRoomCategories,
  mergeSpatialOcrIntoRooms,
  ocrRoomCategoryFromLabel,
} from "./ocrSpatialRooms";
import type { ExtractedGeometryRoom } from "./wallBoundedRooms";

describe("ocrRoomCategoryFromLabel", () => {
  it("classifies living and kitchen", () => {
    expect(ocrRoomCategoryFromLabel("Open Living")).toBe("living");
    expect(ocrRoomCategoryFromLabel("Kitchen")).toBe("kitchen");
    expect(ocrRoomCategoryFromLabel("Living / Kitchen")).toBe("living");
    expect(ocrRoomCategoryFromLabel("Dining")).toBe("dining");
  });
});

describe("assignOcrSeedsToUnits", () => {
  it("places OCR text inside the matching unit boundary", () => {
    const units = [
      {
        unitId: "u1",
        unitLabel: "Unit 101",
        points: [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
          { x: 200, y: 200 },
          { x: 0, y: 200 },
        ],
      },
      {
        unitId: "u2",
        unitLabel: "Unit 102",
        points: [
          { x: 220, y: 0 },
          { x: 420, y: 0 },
          { x: 420, y: 200 },
          { x: 220, y: 200 },
        ],
      },
    ];

    const assigned = assignOcrSeedsToUnits(
      [
        { label: "Kitchen", text: "KITCHEN", centroid: { x: 50, y: 50 } },
        { label: "Open Living", text: "LIVING", centroid: { x: 300, y: 80 } },
      ],
      units,
    );

    expect(assigned[0].unitId).toBe("u1");
    expect(assigned[1].unitId).toBe("u2");
  });
});

describe("dedupePerUnitRoomCategories", () => {
  it("keeps one kitchen per unit", () => {
    const units = [
      {
        unitId: "u1",
        unitLabel: "Unit 101",
        points: [
          { x: 0, y: 0 },
          { x: 300, y: 0 },
          { x: 300, y: 300 },
          { x: 0, y: 300 },
        ],
      },
    ];

    const rooms = dedupePerUnitRoomCategories(
      [
        {
          id: "a",
          label: "Kitchen",
          category: "kitchen",
          text: "KITCHEN",
          centroid: { x: 50, y: 50 },
          unitId: "u1",
          unitLabel: "Unit 101",
        },
        {
          id: "b",
          label: "Kitchen",
          category: "kitchen",
          text: "KIT",
          centroid: { x: 200, y: 200 },
          unitId: "u1",
          unitLabel: "Unit 101",
        },
      ],
      units,
    );

    expect(rooms).toHaveLength(1);
    expect(rooms[0].id).toBe("b");
  });
});

describe("mergeSpatialOcrIntoRooms", () => {
  const baseRoom = (overrides: Partial<ExtractedGeometryRoom>): ExtractedGeometryRoom => ({
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
    ...overrides,
  });

  it("labels geometry rooms from OCR within the same unit", () => {
    const entities = [
      {
        id: "u1",
        type: "unit_boundary",
        label: "Unit 101",
        status: "confirmed",
        geometry: {
          kind: "polygon",
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 200 },
            { x: 0, y: 200 },
          ],
        },
      },
    ];

    const { rooms } = mergeSpatialOcrIntoRooms(
      [baseRoom({ id: "r1", label: "Room" })],
      [{ text: "KITCHEN", bbox: [[50, 50], [60, 50], [60, 60], [50, 60]] }],
      entities,
    );

    expect(rooms.find((r) => r.id === "r1")?.label).toBe("Kitchen");
  });

  it("captures printed size under a room type", () => {
    const entities = [
      {
        id: "u1",
        type: "unit_boundary",
        label: "Unit 101",
        status: "confirmed",
        geometry: {
          kind: "polygon",
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 200 },
            { x: 0, y: 200 },
          ],
        },
      },
    ];

    const { rooms } = mergeSpatialOcrIntoRooms(
      [baseRoom({ id: "r1", label: "Room" })],
      [
        { text: "BEDROOM", bbox: [[70, 60], [120, 60], [120, 72], [70, 72]] },
        { text: "3.9m x 3.9 m", bbox: [[68, 76], [140, 76], [140, 88], [68, 88]] },
      ],
      entities,
    );

    const bedroom = rooms.find((r) => r.id === "r1");
    expect(bedroom?.label).toBe("Bedroom");
    expect(bedroom?.labeledSizeText).toBe("3.9 × 3.9 m");
    expect(bedroom?.widthM).toBe(3.9);
    expect(bedroom?.depthM).toBe(3.9);
  });

  it("adds anchor room when OCR label has no matching geometry", () => {
    const entities = [
      {
        id: "u1",
        type: "unit_boundary",
        label: "Unit 101",
        status: "confirmed",
        geometry: {
          kind: "polygon",
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 200 },
            { x: 0, y: 200 },
          ],
        },
      },
    ];

    const { rooms, ocrRooms } = mergeSpatialOcrIntoRooms(
      [],
      [{ text: "LIVING / DINING", bbox: [[80, 80], [120, 80], [120, 90], [80, 90]] }],
      entities,
    );

    expect(ocrRooms.some((r) => r.category === "living")).toBe(true);
    expect(rooms.some((r) => r.label === "Living / Dining")).toBe(true);
  });

  it("picks uppercase LIVING as open living", () => {
    const entities = [
      {
        id: "u1",
        type: "unit_boundary",
        label: "Unit 101",
        status: "confirmed",
        geometry: {
          kind: "polygon",
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 200 },
            { x: 0, y: 200 },
          ],
        },
      },
    ];

    const { rooms } = mergeSpatialOcrIntoRooms(
      [baseRoom({ id: "r1", label: "Room" })],
      [{ text: "LIVING", bbox: [[80, 80], [130, 80], [130, 92], [80, 92]] }],
      entities,
    );

    expect(rooms.find((r) => r.id === "r1")?.label).toBe("Open Living");
  });

  it("combines living dining kitchen labels in one room", () => {
    const entities = [
      {
        id: "u1",
        type: "unit_boundary",
        label: "Unit 101",
        status: "confirmed",
        geometry: {
          kind: "polygon",
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 200 },
            { x: 0, y: 200 },
          ],
        },
      },
    ];

    const { rooms } = mergeSpatialOcrIntoRooms(
      [baseRoom({ id: "r1", label: "Room" })],
      [
        { text: "LIVING", bbox: [[40, 40], [90, 40], [90, 52], [40, 52]] },
        { text: "DINING", bbox: [[50, 58], [100, 58], [100, 70], [50, 70]] },
        { text: "KITCHEN", bbox: [[60, 76], [120, 76], [120, 88], [60, 88]] },
      ],
      entities,
    );

    expect(rooms.filter((r) => r.unitId === "u1")).toHaveLength(1);
    expect(rooms.find((r) => r.id === "r1")?.label).toBe("Living / Dining / Kitchen");
  });

  it("maps numbered bedrooms only when OCR text is inside the flood room", () => {
    const entities = [
      {
        id: "u1",
        type: "unit_boundary",
        label: "Unit 101",
        status: "confirmed",
        geometry: {
          kind: "polygon",
          points: [
            { x: 0, y: 0 },
            { x: 300, y: 0 },
            { x: 300, y: 150 },
            { x: 0, y: 150 },
          ],
        },
      },
    ];

    const room = (id: string, x: number): ExtractedGeometryRoom => ({
      id,
      label: "Room",
      unitId: "u1",
      unitLabel: "Unit 101",
      isCommon: false,
      points: [
        { x, y: 0 },
        { x: x + 100, y: 0 },
        { x: x + 100, y: 100 },
        { x, y: 100 },
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
    });

    const { rooms } = mergeSpatialOcrIntoRooms(
      [room("r1", 0), room("r2", 150)],
      [
        { text: "BED 1", bbox: [[40, 40], [70, 40], [70, 52], [40, 52]] },
        { text: "BED 2", bbox: [[190, 40], [220, 40], [220, 52], [190, 52]] },
      ],
      entities,
    );

    expect(rooms.find((r) => r.id === "r1")?.label).toBe("Bedroom 1");
    expect(rooms.find((r) => r.id === "r2")?.label).toBe("Bedroom 2");
  });
});

describe("buildSpatialOcrRooms", () => {
  it("dedupes living labels per unit from OCR lines", () => {
    const units = [
      {
        unitId: "u1",
        unitLabel: "Unit 101",
        points: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
          { x: 400, y: 400 },
          { x: 0, y: 400 },
        ],
      },
    ];

    const rooms = buildSpatialOcrRooms(
      [
        { text: "LIVING", bbox: [[50, 50], [80, 50], [80, 60], [50, 60]] },
        { text: "LIVING / DINING", bbox: [[200, 200], [260, 200], [260, 210], [200, 210]] },
        { text: "KITCHEN", bbox: [[340, 340], [380, 340], [380, 352], [340, 352]] },
      ],
      units,
    );

    expect(rooms.filter((r) => r.category === "living")).toHaveLength(1);
    expect(rooms.filter((r) => r.category === "kitchen")).toHaveLength(1);
  });

  it("clusters nearby living and kitchen into one open-plan room", () => {
    const units = [
      {
        unitId: "u1",
        unitLabel: "Unit 101",
        points: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
          { x: 400, y: 400 },
          { x: 0, y: 400 },
        ],
      },
    ];

    const rooms = buildSpatialOcrRooms(
      [
        { text: "LIVING", bbox: [[50, 50], [90, 50], [90, 62], [50, 62]] },
        { text: "KITCHEN", bbox: [[70, 70], [120, 70], [120, 82], [70, 82]] },
        { text: "DINING", bbox: [[55, 88], [105, 88], [105, 100], [55, 100]] },
      ],
      units,
    );

    expect(rooms).toHaveLength(1);
    expect(rooms[0].label).toBe("Living / Dining / Kitchen");
  });
});
