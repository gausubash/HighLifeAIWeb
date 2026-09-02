import { describe, expect, it } from "vitest";
import type { OverlayGeometry } from "@/features/plan-editor/types";
import {
  extractCommunalOcrSeeds,
  extractDrawingUnitLabels,
  inferUnitBoundaries,
  isCommunalOcrText,
  isEnvelopeOutlineWall,
  parseUnitTokenFromLine,
  type InferOverlayEntity,
} from "./inferUnitBoundaries";

function rect(id: string, type: string, label: string, x: number, y: number, w: number, h: number, extra?: Partial<InferOverlayEntity>): InferOverlayEntity {
  return {
    id,
    type,
    label,
    geometry: { kind: "rect", x, y, width: w, height: h },
    source: extra?.source ?? "model",
    attributes: { label, ...(extra?.attributes ?? {}) },
    ...extra,
  };
}

function poly(id: string, type: string, label: string, points: { x: number; y: number }[], extra?: Partial<InferOverlayEntity>): InferOverlayEntity {
  return {
    id,
    type,
    label,
    geometry: { kind: "polygon", points } satisfies OverlayGeometry,
    source: extra?.source ?? "model",
    attributes: { label, ...(extra?.attributes ?? {}) },
    ...extra,
  };
}

describe("parseUnitTokenFromLine", () => {
  it("requires a dwelling word or U prefix, not a bare number", () => {
    expect(parseUnitTokenFromLine("Unit 101")).toBe("101");
    expect(parseUnitTokenFromLine("apartment 37")).toBe("37");
    expect(parseUnitTokenFromLine("APT 203")).toBe("203");
    expect(parseUnitTokenFromLine("U34")).toBe("34");
    expect(parseUnitTokenFromLine("Unit No. 12B")).toBe("12B");
    expect(parseUnitTokenFromLine("5A")).toBeNull();
    expect(parseUnitTokenFromLine("10")).toBeNull();
    expect(parseUnitTokenFromLine("37")).toBeNull();
    expect(parseUnitTokenFromLine("1:100")).toBeNull();
    expect(parseUnitTokenFromLine("SCALE")).toBeNull();
    expect(parseUnitTokenFromLine("apartment EN")).toBeNull();
    expect(parseUnitTokenFromLine("UNIT CT")).toBeNull();
    expect(parseUnitTokenFromLine("Unit A")).toBe("A");
  });
});

describe("extractDrawingUnitLabels", () => {
  it("pairs a nearby prefix line with a number", () => {
    const seeds = extractDrawingUnitLabels([
      { text: "APT", confidence: 0.9, bbox: [[10, 10], [40, 10], [40, 24], [10, 24]] },
      { text: "203", confidence: 0.9, bbox: [[46, 10], [80, 10], [80, 24], [46, 24]] },
      { text: "1500", confidence: 0.9, bbox: [[200, 80], [240, 80], [240, 96], [200, 96]] },
    ]);
    expect(seeds.map((s) => s.unitId)).toEqual(["203"]);
  });
});

describe("extractCommunalOcrSeeds", () => {
  it("keeps lobby/corridor/lift/stair text and ignores unit ids and dimensions", () => {
    expect(isCommunalOcrText("LOBBY")).toBe(true);
    expect(isCommunalOcrText("Corridor")).toBe(true);
    expect(isCommunalOcrText("LIFT")).toBe(true);
    expect(isCommunalOcrText("STAIR")).toBe(true);
    expect(isCommunalOcrText("Hall")).toBe(true);
    expect(isCommunalOcrText("Unit 37")).toBe(false);
    expect(isCommunalOcrText("1500")).toBe(false);
    expect(isCommunalOcrText("Bedroom")).toBe(false);

    const seeds = extractCommunalOcrSeeds([
      { text: "LOBBY", confidence: 0.9, bbox: [[90, 8], [120, 8], [120, 22], [90, 22]] },
      { text: "Unit 37", confidence: 0.9, bbox: [[20, 70], [50, 70], [50, 90], [20, 90]] },
      { text: "1500", confidence: 0.9, bbox: [[200, 80], [240, 80], [240, 96], [200, 96]] },
    ]);
    expect(seeds.map((s) => s.label)).toEqual(["LOBBY"]);
  });
});

describe("inferUnitBoundaries", () => {
  it("clusters private rooms split at the lobby and labels from drawing OCR", () => {
    const entities: InferOverlayEntity[] = [
      rect("lobby", "room", "Lobby", 0, 0, 200, 40),
      rect("bed-a", "room", "Bedroom", 0, 50, 80, 80),
      rect("bath-a", "room", "Bathroom", 10, 140, 60, 40),
      rect("bed-b", "room", "Bedroom", 120, 50, 80, 80),
      rect("bath-b", "room", "Bathroom", 130, 140, 60, 40),
      rect("main-a", "door", "Main Door", 30, 36, 16, 16),
      rect("main-b", "door", "Main Door", 150, 36, 16, 16),
      rect("int-a", "door", "Single Door", 30, 124, 16, 16),
      rect("int-b", "door", "Single Door", 150, 124, 16, 16),
    ];
    const result = inferUnitBoundaries({
      entities,
      widthPx: 220,
      heightPx: 200,
      pageNumber: 1,
      drawingOcrMeta: {
        lines: [
          { text: "Unit 2", confidence: 0.9, bbox: [[20, 70], [40, 70], [40, 90], [20, 90]] },
          { text: "APT 10A", confidence: 0.9, bbox: [[140, 70], [170, 70], [170, 90], [140, 90]] },
        ],
      },
    });

    expect(result.createdEntities).toHaveLength(2);
    const labels = result.createdEntities.map((e) => e.label).sort();
    expect(labels).toEqual(["Unit 10A", "Unit 2"]);
    const unit2 = result.units.find((u) => u.unitId === "2");
    const unit10 = result.units.find((u) => u.unitId === "10A");
    expect(unit2?.roomIds.sort()).toEqual(["bath-a", "bed-a"]);
    expect(unit10?.roomIds.sort()).toEqual(["bath-b", "bed-b"]);
    expect(unit2?.entranceIds).toContain("main-a");
    expect(unit10?.entranceIds).toContain("main-b");
    expect(unit2?.method).toBe("room_door_cluster");
  });

  it("keeps YOLO Unit polygons and does not duplicate them", () => {
    const entities: InferOverlayEntity[] = [
      poly(
        "yolo-unit",
        "unit_boundary",
        "Unit",
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
        ],
        { source: "model" },
      ),
      rect("bed", "room", "Bedroom", 10, 10, 40, 40),
      rect("lobby", "room", "Lobby", 110, 10, 40, 40),
    ];
    const result = inferUnitBoundaries({
      entities,
      widthPx: 200,
      heightPx: 120,
      drawingOcrMeta: {
        lines: [{ text: "Unit 101", confidence: 0.9, bbox: [[20, 20], [50, 20], [50, 40], [20, 40]] }],
      },
    });
    expect(result.createdEntities).toHaveLength(0);
    expect(result.yoloLabelPatches).toEqual([
      expect.objectContaining({ id: "yolo-unit", label: "Unit 101" }),
    ]);
    expect(result.units[0]?.method).toBe("yolo");
    expect(result.units[0]?.roomIds).toContain("bed");
  });

  it("flood-fills from OCR labels when walls exist and rooms do not", () => {
    const entities: InferOverlayEntity[] = [
      {
        id: "wall",
        type: "wall",
        label: "Wall",
        source: "model",
        geometry: {
          kind: "polyline",
          points: [
            { x: 50, y: 0 },
            { x: 50, y: 100 },
          ],
        },
      },
    ];
    const result = inferUnitBoundaries({
      entities,
      widthPx: 100,
      heightPx: 100,
      pageNumber: 3,
      drawingOcrMeta: {
        lines: [
          { text: "U1", confidence: 0.9, bbox: [[10, 40], [20, 40], [20, 55], [10, 55]] },
          { text: "U2", confidence: 0.9, bbox: [[70, 40], [80, 40], [80, 55], [70, 55]] },
        ],
      },
    });
    expect(result.createdEntities).toHaveLength(2);
    expect(result.units.every((u) => u.method === "wall_flood_fill")).toBe(true);
    expect(result.units.every((u) => u.reviewRequired)).toBe(true);
    const left = result.units.find((u) => u.unitId === "1");
    const right = result.units.find((u) => u.unitId === "2");
    const leftCx = left!.points.reduce((s, p) => s + p.x, 0) / left!.points.length;
    const rightCx = right!.points.reduce((s, p) => s + p.x, 0) / right!.points.length;
    expect(leftCx).toBeLessThan(50);
    expect(rightCx).toBeGreaterThan(50);
  });

  it("does not invent a unit from OCR text when there are no walls", () => {
    const result = inferUnitBoundaries({
      entities: [rect("bed", "room", "Bedroom", 10, 10, 40, 40)],
      widthPx: 200,
      heightPx: 120,
      drawingOcrMeta: {
        lines: [{ text: "Unit 101", confidence: 0.9, bbox: [[20, 20], [50, 20], [50, 40], [20, 40]] }],
      },
    });
    expect(result.createdEntities).toHaveLength(0);
  });

  it("does not invent a unit from lobby OCR when there are no walls", () => {
    const result = inferUnitBoundaries({
      entities: [
        rect("bed-a", "room", "Bedroom", 10, 50, 70, 80),
        rect("bed-b", "room", "Bedroom", 120, 50, 70, 80),
      ],
      widthPx: 200,
      heightPx: 200,
      drawingOcrMeta: {
        lines: [{ text: "LOBBY", confidence: 0.9, bbox: [[80, 8], [120, 8], [120, 22], [80, 22]] }],
      },
    });
    expect(result.createdEntities).toHaveLength(0);
  });

  it("does not treat dimension or room numbers as units", () => {
    const result = inferUnitBoundaries({
      entities: [
        {
          id: "wall",
          type: "wall",
          label: "Wall",
          source: "model",
          geometry: { kind: "polyline", points: [{ x: 50, y: 0 }, { x: 50, y: 100 }] },
        },
      ],
      widthPx: 100,
      heightPx: 100,
      drawingOcrMeta: {
        lines: [
          { text: "37", confidence: 0.9, bbox: [[10, 40], [24, 40], [24, 55], [10, 55]] },
          { text: "203", confidence: 0.9, bbox: [[70, 40], [90, 40], [90, 55], [70, 55]] },
        ],
      },
    });
    expect(result.createdEntities).toHaveLength(0);
  });

  it("clips flood-fill units to the external wall envelope", () => {
    const entities: InferOverlayEntity[] = [
      poly(
        "ext",
        "wall",
        "External Wall",
        [
          { x: 20, y: 20 },
          { x: 180, y: 20 },
          { x: 180, y: 180 },
          { x: 20, y: 180 },
        ],
      ),
      {
        id: "split",
        type: "wall",
        label: "Wall",
        source: "model",
        geometry: {
          kind: "polyline",
          points: [
            { x: 100, y: 20 },
            { x: 100, y: 180 },
          ],
        },
      },
    ];
    const result = inferUnitBoundaries({
      entities,
      widthPx: 400,
      heightPx: 400,
      pageNumber: 1,
      drawingOcrMeta: {
        lines: [
          { text: "apartment 1", confidence: 0.9, bbox: [[40, 80], [55, 80], [55, 100], [40, 100]] },
          { text: "apartment 2", confidence: 0.9, bbox: [[130, 80], [145, 80], [145, 100], [130, 100]] },
        ],
      },
    });
    expect(result.createdEntities).toHaveLength(2);
    for (const unit of result.units) {
      const xs = unit.points.map((p) => p.x);
      const ys = unit.points.map((p) => p.y);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(18);
      expect(Math.max(...xs)).toBeLessThanOrEqual(182);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(18);
      expect(Math.max(...ys)).toBeLessThanOrEqual(182);
    }
  });

  it("follows an L-shaped wall pocket instead of a rectangular hull", () => {
    const entities: InferOverlayEntity[] = [
      poly(
        "ext",
        "wall",
        "External Wall",
        [
          { x: 10, y: 10 },
          { x: 90, y: 10 },
          { x: 90, y: 90 },
          { x: 10, y: 90 },
        ],
      ),
      {
        id: "v",
        type: "wall",
        label: "Wall",
        source: "model",
        geometry: { kind: "polyline", points: [{ x: 50, y: 10 }, { x: 50, y: 50 }] },
      },
      {
        id: "h",
        type: "wall",
        label: "Wall",
        source: "model",
        geometry: { kind: "polyline", points: [{ x: 50, y: 50 }, { x: 90, y: 50 }] },
      },
    ];
    const result = inferUnitBoundaries({
      entities,
      widthPx: 100,
      heightPx: 100,
      pageNumber: 4,
      drawingOcrMeta: {
        lines: [{ text: "U1", confidence: 0.9, bbox: [[18, 20], [28, 20], [28, 32], [18, 32]] }],
      },
    });
    expect(result.createdEntities).toHaveLength(1);
    const notch = result.units[0]!.points.some((p) => p.x > 72 && p.y < 32);
    expect(notch).toBe(false);
  });

  it("infers main doors from lobby OCR and structural Door labels, then flood-fills units", () => {
    const entities: InferOverlayEntity[] = [
      poly(
        "ext",
        "wall",
        "External Wall",
        [
          { x: 4, y: 4 },
          { x: 196, y: 4 },
          { x: 196, y: 196 },
          { x: 4, y: 196 },
        ],
        { source: "model", attributes: { detectFamily: "structural" } },
      ),
      rect("sep", "wall", "Wall", 4, 30, 192, 8, {
        source: "model",
        attributes: { detectFamily: "structural", source: "roboflow-floorplan-seg" },
      }),
      rect("party", "wall", "Wall", 96, 30, 8, 166, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
      rect("door-a", "door", "Door", 44, 34, 18, 10, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
      rect("door-b", "door", "Door", 140, 34, 18, 10, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
      rect("int-a", "door", "Door", 44, 110, 10, 10, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
      rect("bed-a", "room", "Bedroom", 12, 50, 70, 80),
      rect("bed-b", "room", "Bedroom", 118, 50, 70, 80),
    ];
    const result = inferUnitBoundaries({
      entities,
      widthPx: 200,
      heightPx: 200,
      pageNumber: 11,
      drawingOcrMeta: {
        lines: [
          { text: "LIFT LOBBY", confidence: 0.9, bbox: [[82, 8], [124, 8], [124, 22], [82, 22]] },
          { text: "Unit 2", confidence: 0.9, bbox: [[20, 70], [40, 70], [40, 90], [20, 90]] },
          { text: "APT 10A", confidence: 0.9, bbox: [[140, 70], [170, 70], [170, 90], [140, 90]] },
        ],
      },
    });

    expect(result.createdEntities.length).toBeGreaterThanOrEqual(2);
    const mainDoorUnits = result.units.filter((u) => u.method === "communal_main_door");
    expect(mainDoorUnits.length).toBeGreaterThanOrEqual(2);
    const unit2 = result.units.find((u) => u.unitId === "2");
    const unit10 = result.units.find((u) => u.unitId === "10A");
    expect(unit2?.entranceIds).toContain("door-a");
    expect(unit10?.entranceIds).toContain("door-b");
    expect(unit2?.entranceIds).not.toContain("int-a");
  });

  it("seeds communal flood from lobby OCR and leaves two apartments when unit ids are missing", () => {
    const entities: InferOverlayEntity[] = [
      poly(
        "ext",
        "wall",
        "External Wall",
        [
          { x: 4, y: 4 },
          { x: 196, y: 4 },
          { x: 196, y: 196 },
          { x: 4, y: 196 },
        ],
      ),
      rect("sep", "wall", "Wall", 4, 30, 192, 8),
      rect("party", "wall", "Wall", 96, 30, 8, 166),
      rect("bed-a", "room", "Bedroom", 12, 50, 70, 80),
      rect("bed-b", "room", "Bedroom", 118, 50, 70, 80),
    ];
    const result = inferUnitBoundaries({
      entities,
      widthPx: 200,
      heightPx: 200,
      pageNumber: 8,
      drawingOcrMeta: {
        lines: [{ text: "LOBBY", confidence: 0.9, bbox: [[88, 8], [118, 8], [118, 22], [88, 22]] }],
      },
    });

    expect(result.createdEntities).toHaveLength(2);
    expect(result.units.every((u) => u.method === "communal_residual")).toBe(true);
    expect(result.units.every((u) => u.reviewRequired)).toBe(true);
    const left = result.units.find((u) => u.roomIds.includes("bed-a"));
    const right = result.units.find((u) => u.roomIds.includes("bed-b"));
    expect(left).toBeTruthy();
    expect(right).toBeTruthy();
    expect(left?.roomIds).not.toContain("bed-b");
    expect(right?.roomIds).not.toContain("bed-a");
    expect(left?.points.some((p) => p.y < 24)).toBe(false);
    expect(right?.points.some((p) => p.y < 24)).toBe(false);
  });

  it("labels apartments from OCR and splits at lobby without room overlays", () => {
    const entities: InferOverlayEntity[] = [
      poly(
        "ext",
        "wall",
        "External Wall",
        [
          { x: 4, y: 4 },
          { x: 196, y: 4 },
          { x: 196, y: 196 },
          { x: 4, y: 196 },
        ],
        { source: "model", attributes: { detectFamily: "structural" } },
      ),
      rect("sep", "wall", "Wall", 4, 30, 192, 8, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
      rect("party", "wall", "Wall", 96, 38, 8, 158, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
      rect("door-a", "door", "Door", 44, 34, 18, 10, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
      rect("door-b", "door", "Door", 140, 34, 18, 10, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
      rect("int-a", "door", "Door", 44, 110, 10, 10, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
      rect("int-b", "door", "Door", 140, 110, 10, 10, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
    ];
    const result = inferUnitBoundaries({
      entities,
      widthPx: 200,
      heightPx: 200,
      pageNumber: 12,
      drawingOcrMeta: {
        lines: [
          { text: "LOBBY", confidence: 0.9, bbox: [[88, 8], [118, 8], [118, 22], [88, 22]] },
          { text: "apartment 32", confidence: 0.9, bbox: [[20, 70], [55, 70], [55, 90], [20, 90]] },
          { text: "apartment 33", confidence: 0.9, bbox: [[130, 70], [165, 70], [165, 90], [130, 90]] },
        ],
      },
    });

    expect(result.createdEntities.length).toBeGreaterThanOrEqual(2);
    const apt32 = result.units.find((u) => u.unitId === "32");
    const apt33 = result.units.find((u) => u.unitId === "33");
    expect(apt32?.label).toBe("Apartment 32");
    expect(apt33?.label).toBe("Apartment 33");
    expect(apt32?.method).toMatch(/communal_main_door|wall_flood_fill/);
    expect(apt33?.method).toMatch(/communal_main_door|wall_flood_fill/);
    expect(apt32?.points.some((p) => p.x < 96)).toBe(true);
    expect(apt33?.points.some((p) => p.x > 96)).toBe(true);
    expect(apt32?.points.some((p) => p.y < 30)).toBe(false);
    expect(apt33?.points.some((p) => p.y < 30)).toBe(false);
  });

  it("separates units from structural walls and doors without lobby OCR", () => {
    const entities: InferOverlayEntity[] = [
      poly(
        "ext",
        "wall",
        "External Wall",
        [
          { x: 4, y: 4 },
          { x: 196, y: 4 },
          { x: 196, y: 196 },
          { x: 4, y: 196 },
        ],
        { source: "model", attributes: { detectFamily: "structural" } },
      ),
      rect("sep", "wall", "Wall", 4, 30, 192, 8, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
      rect("party", "wall", "Wall", 96, 38, 8, 158, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
      rect("door-a", "door", "Door", 44, 34, 18, 10, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
      rect("door-b", "door", "Door", 140, 34, 18, 10, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
      rect("int-a", "door", "Door", 44, 110, 10, 10, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
    ];
    const result = inferUnitBoundaries({
      entities,
      widthPx: 200,
      heightPx: 200,
      pageNumber: 13,
    });

    expect(result.createdEntities.length).toBeGreaterThanOrEqual(2);
    expect(result.units.filter((u) => u.method === "communal_main_door").length).toBeGreaterThanOrEqual(2);
    expect(result.units.some((u) => u.entranceIds.includes("door-a"))).toBe(true);
    expect(result.units.some((u) => u.entranceIds.includes("door-b"))).toBe(true);
  });

  it("does not merge adjacent units across an External Wall party segment", () => {
    const entities: InferOverlayEntity[] = [
      poly(
        "ext",
        "wall",
        "External Wall",
        [
          { x: 4, y: 4 },
          { x: 196, y: 4 },
          { x: 196, y: 196 },
          { x: 4, y: 196 },
        ],
        { source: "model", attributes: { detectFamily: "structural" } },
      ),
      rect("party", "wall", "External Wall", 96, 38, 8, 158, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
      rect("sep", "wall", "Wall", 4, 30, 192, 8, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
      rect("door-a", "door", "Door", 44, 34, 18, 10, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
      rect("door-b", "door", "Door", 140, 34, 18, 10, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
    ];
    const result = inferUnitBoundaries({
      entities,
      widthPx: 200,
      heightPx: 200,
      pageNumber: 14,
      drawingOcrMeta: {
        lines: [
          { text: "LOBBY", confidence: 0.9, bbox: [[88, 8], [118, 8], [118, 22], [88, 22]] },
          { text: "apartment 31", confidence: 0.9, bbox: [[20, 70], [55, 70], [55, 90], [20, 90]] },
          { text: "apartment 32", confidence: 0.9, bbox: [[130, 70], [165, 70], [165, 90], [130, 90]] },
        ],
      },
    });

    const u31 = result.units.find((u) => u.unitId === "31");
    const u32 = result.units.find((u) => u.unitId === "32");
    expect(u31).toBeTruthy();
    expect(u32).toBeTruthy();
    expect(u31!.points.some((p) => p.x > 104)).toBe(false);
    expect(u32!.points.some((p) => p.x < 96)).toBe(false);
  });

  it("merges extra main-door regions into nearest apartments instead of U1 U3", () => {
    const entities: InferOverlayEntity[] = [
      poly(
        "ext",
        "wall",
        "External Wall",
        [
          { x: 4, y: 4 },
          { x: 396, y: 4 },
          { x: 396, y: 196 },
          { x: 4, y: 196 },
        ],
        { source: "model", attributes: { detectFamily: "structural" } },
      ),
      rect("sep", "wall", "Wall", 4, 30, 392, 8, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
      rect("party-a", "wall", "Wall", 96, 38, 8, 158, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
      rect("party-b", "wall", "Wall", 196, 38, 8, 158, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
      rect("party-c", "wall", "Wall", 296, 38, 8, 158, {
        source: "model",
        attributes: { detectFamily: "structural" },
      }),
      ...["a", "b", "c", "d"].map(
        (id, idx) =>
          rect(`door-${id}`, "door", "Door", 44 + idx * 100, 34, 18, 10, {
            source: "model",
            attributes: { detectFamily: "structural" },
          }) as InferOverlayEntity,
      ),
      ...["a", "b", "c", "d"].map(
        (id, idx) =>
          rect(`int-${id}`, "door", "Door", 44 + idx * 100, 110, 10, 10, {
            source: "model",
            attributes: { detectFamily: "structural" },
          }) as InferOverlayEntity,
      ),
    ];
    const result = inferUnitBoundaries({
      entities,
      widthPx: 400,
      heightPx: 200,
      pageNumber: 15,
      drawingOcrMeta: {
        lines: [
          { text: "LOBBY", confidence: 0.9, bbox: [[188, 8], [218, 8], [218, 22], [188, 22]] },
          { text: "apartment 31", confidence: 0.9, bbox: [[20, 70], [55, 70], [55, 90], [20, 90]] },
          { text: "apartment 32", confidence: 0.9, bbox: [[120, 70], [155, 70], [155, 90], [120, 90]] },
        ],
      },
    });

    const labels = result.units.map((u) => u.label);
    expect(labels.every((l) => !/^Unit U?\d+$/i.test(l) || l.includes("31") || l.includes("32"))).toBe(true);
    expect(labels.some((l) => l.includes("31"))).toBe(true);
    expect(labels.some((l) => l.includes("32"))).toBe(true);
    expect(result.units.filter((u) => /^U?\d+$/.test(u.unitId) && !["31", "32"].includes(u.unitId)).length).toBe(0);
    expect(result.units.length).toBeLessThanOrEqual(3);
  });

  it("uses a lobby room overlay as a communal seed when OCR has no unit ids", () => {
    const entities: InferOverlayEntity[] = [
      poly(
        "ext",
        "wall",
        "External Wall",
        [
          { x: 4, y: 4 },
          { x: 196, y: 4 },
          { x: 196, y: 196 },
          { x: 4, y: 196 },
        ],
      ),
      rect("sep", "wall", "Wall", 4, 30, 192, 8),
      rect("party", "wall", "Wall", 96, 30, 8, 166),
      rect("lobby", "room", "Lobby", 10, 6, 180, 22),
      rect("bed-a", "room", "Bedroom", 12, 50, 70, 80),
      rect("bed-b", "room", "Bedroom", 118, 50, 70, 80),
    ];
    const result = inferUnitBoundaries({
      entities,
      widthPx: 200,
      heightPx: 200,
      pageNumber: 9,
    });

    expect(result.createdEntities).toHaveLength(2);
    expect(result.units.every((u) => u.method === "communal_residual")).toBe(true);
    expect(result.units.find((u) => u.roomIds.includes("bed-a"))?.roomIds).not.toContain("bed-b");
  });
});
