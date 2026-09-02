import { describe, expect, it } from "vitest";
import { mergeDetectedRoomLabels } from "./mergeDetectedRoomLabels";
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

describe("mergeDetectedRoomLabels", () => {
  it("labels generic flood rooms from detected room polygons", () => {
    const rooms = [room("r1", "Room", 0, 0, 100, 100)];
    const entities = [
      {
        id: "det1",
        type: "room",
        label: "Open Living",
        status: "predicted",
        geometry: {
          kind: "polygon" as const,
          points: [
            { x: 10, y: 10 },
            { x: 90, y: 10 },
            { x: 90, y: 90 },
            { x: 10, y: 90 },
          ],
        },
      },
    ];

    const merged = mergeDetectedRoomLabels(rooms, entities);
    expect(merged[0].label).toBe("Open Living");
  });

  it("maps uppercase LIVING detections onto flood rooms", () => {
    const rooms = [room("r1", "Room", 0, 0, 100, 100)];
    const entities = [
      {
        id: "det1",
        type: "room",
        label: "LIVING",
        status: "predicted",
        geometry: {
          kind: "polygon" as const,
          points: [
            { x: 10, y: 10 },
            { x: 90, y: 10 },
            { x: 90, y: 90 },
            { x: 10, y: 90 },
          ],
        },
      },
    ];

    expect(mergeDetectedRoomLabels(rooms, entities)[0].label).toBe("Open Living");
  });

  it("does not override specific OCR or detection labels already on the room", () => {
    const rooms = [room("r1", "Bedroom 1", 0, 0, 100, 100)];
    const entities = [
      {
        id: "det1",
        type: "room",
        label: "Kitchen",
        status: "predicted",
        geometry: {
          kind: "polygon" as const,
          points: [
            { x: 10, y: 10 },
            { x: 90, y: 10 },
            { x: 90, y: 90 },
            { x: 10, y: 90 },
          ],
        },
      },
    ];

    expect(mergeDetectedRoomLabels(rooms, entities)[0].label).toBe("Bedroom 1");
  });
});
