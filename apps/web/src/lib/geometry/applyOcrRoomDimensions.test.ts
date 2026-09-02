import { describe, expect, it } from "vitest";
import { applyOcrRoomDimensions } from "./applyOcrRoomDimensions";
import type { ExtractedGeometryRoom } from "./wallBoundedRooms";

function room(id: string, label: string, x: number, y: number, w: number, h: number): ExtractedGeometryRoom {
  return {
    id,
    label,
    unitId: "u1",
    unitLabel: "Unit 1",
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

describe("applyOcrRoomDimensions", () => {
  it("pairs a size printed under Bedroom", () => {
    const rooms = [room("r1", "Bedroom", 0, 0, 200, 200)];
    const next = applyOcrRoomDimensions(rooms, [
      { text: "BEDROOM", bbox: [[80, 70], [130, 70], [130, 82], [80, 82]] },
      { text: "3.9m x 3.9 m", bbox: [[78, 86], [148, 86], [148, 98], [78, 98]] },
    ]);

    expect(next[0].labeledSizeText).toBe("3.9 × 3.9 m");
    expect(next[0].widthM).toBe(3.9);
    expect(next[0].depthM).toBe(3.9);
    expect(next[0].areaM2).toBeCloseTo(15.21);
  });

  it("reads size on the same line as the room type", () => {
    const rooms = [room("r1", "Room", 0, 0, 160, 160)];
    const next = applyOcrRoomDimensions(rooms, [
      { text: "Living 4.2 x 5.1", bbox: [[40, 40], [110, 40], [110, 52], [40, 52]] },
    ]);

    expect(next[0].labeledWidthM).toBe(4.2);
    expect(next[0].labeledDepthM).toBe(5.1);
  });

  it("joins a size split across PDF text items", () => {
    const rooms = [room("r1", "Bedroom", 0, 0, 200, 200)];
    const next = applyOcrRoomDimensions(rooms, [
      { text: "BEDROOM", bbox: [[80, 70], [130, 70], [130, 82], [80, 82]] },
      { text: "3.9m", bbox: [[80, 86], [108, 86], [108, 96], [80, 96]] },
      { text: "x", bbox: [[110, 86], [118, 86], [118, 96], [110, 96]] },
      { text: "3.9m", bbox: [[120, 86], [150, 86], [150, 96], [120, 96]] },
    ]);

    expect(next[0].labeledSizeText).toBe("3.9 × 3.9 m");
  });

  it("joins a size stacked on two lines", () => {
    const rooms = [room("r1", "Bedroom", 0, 0, 200, 200)];
    const next = applyOcrRoomDimensions(rooms, [
      { text: "BEDROOM", bbox: [[80, 70], [130, 70], [130, 82], [80, 82]] },
      { text: "3.9m x", bbox: [[80, 86], [118, 86], [118, 96], [80, 96]] },
      { text: "3.9m", bbox: [[82, 98], [112, 98], [112, 108], [82, 108]] },
    ]);

    expect(next[0].labeledSizeText).toBe("3.9 × 3.9 m");
  });
});
