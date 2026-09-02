import { describe, expect, it } from "vitest";
import type { BuildingHierarchy } from "@highlife/shared-types";
import type { OverlayEntity } from "@/features/plan-editor/types";
import { computeRoomProperties } from "./roomProperties";

function rect(id: string, label: string, x: number, y: number, w: number, h: number): OverlayEntity {
  return {
    id,
    type: "room",
    layer: "rooms",
    label,
    confidence: 1,
    status: "predicted",
    source: "model",
    attributes: {},
    createdAt: "",
    updatedAt: "",
    geometry: { kind: "rect", x, y, width: w, height: h },
  };
}

const hierarchy: BuildingHierarchy = {
  schemaVersion: "1.0.0",
  buildingId: "b",
  projectId: "p",
  analysisId: "a",
  name: "Test",
  floors: [],
  units: [
    {
      id: "u37",
      label: "Unit 37",
      roomIds: ["r1", "r2"],
      bedroomCount: 0,
      bathroomCount: 0,
      confidence: 1,
      reviewRequired: false,
    },
  ],
  rooms: [
    {
      id: "r1",
      label: "Room",
      roomType: "room",
      unitId: "u37",
      isCommon: false,
      confidence: 1,
      objectIds: ["d1"],
    },
    {
      id: "r2",
      label: "Bedroom",
      roomType: "bedroom",
      unitId: "u37",
      isCommon: false,
      confidence: 1,
      objectIds: [],
    },
  ],
  objects: [
    { id: "d1", kind: "door", label: "Single Door", parentRoomId: "r1", parentUnitId: "u37", confidence: 1 },
  ],
  createdAt: "",
  updatedAt: "",
};

describe("computeRoomProperties", () => {
  it("converts area and size with pixelsPerMeter", () => {
    const entities = [rect("r1", "Room", 0, 0, 40, 30), rect("r2", "Bedroom", 38, 0, 20, 30)];
    const props = computeRoomProperties({
      roomId: "r1",
      hierarchy,
      entities,
      pixelsPerMeter: 10,
    });
    expect(props?.unitLabel).toBe("Unit 37");
    expect(props?.areaM2).toBeCloseTo(12);
    expect(props?.widthM).toBeCloseTo(4);
    expect(props?.depthM).toBeCloseTo(3);
    expect(props?.adjacent.map((a) => a.label)).toEqual(["Bedroom"]);
    expect(props?.openings.doors).toEqual(["Single Door"]);
    expect(props?.scaled).toBe(true);
  });

  it("prefers printed OCR size on the room or overlay", () => {
    const props = computeRoomProperties({
      roomId: "r2",
      hierarchy: {
        ...hierarchy,
        rooms: hierarchy.rooms.map((room) =>
          room.id === "r2"
            ? { ...room, labeledWidthM: 3.9, labeledDepthM: 3.9, labeledSizeText: "3.9 × 3.9 m" }
            : room,
        ),
      },
      entities: [rect("r2", "Bedroom", 0, 0, 40, 40)],
      pixelsPerMeter: null,
    });
    expect(props?.widthM).toBe(3.9);
    expect(props?.depthM).toBe(3.9);
    expect(props?.areaM2).toBeCloseTo(15.21);
    expect(props?.scaled).toBe(true);
  });

  it("keeps metre fields null without scale", () => {
    const props = computeRoomProperties({
      roomId: "r1",
      hierarchy,
      entities: [rect("r1", "Room", 0, 0, 40, 30)],
      pixelsPerMeter: null,
    });
    expect(props?.areaM2).toBeNull();
    expect(props?.widthM).toBeNull();
    expect(props?.scaled).toBe(false);
    expect(props?.areaPx2).toBe(1200);
  });
});
