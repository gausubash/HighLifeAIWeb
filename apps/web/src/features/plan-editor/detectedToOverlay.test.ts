import { describe, expect, it } from "vitest";
import { detectedRegionToOverlay } from "./detectedToOverlay";

describe("detectedRegionToOverlay", () => {
  it("maps a classified region onto a predicted overlay polygon", () => {
    const entity = detectedRegionToOverlay({
      id: "reg-1",
      type: "room",
      label: "Bedroom",
      confidence: 0.81,
      polygonPx: [
        { x: 10, y: 10 },
        { x: 80, y: 10 },
        { x: 80, y: 60 },
        { x: 10, y: 60 },
      ],
      bboxPx: { x: 10, y: 10, width: 70, height: 50 },
      attributes: { roomType: "bedroom" },
    });
    expect(entity.source).toBe("model");
    expect(entity.status).toBe("predicted");
    expect(entity.layer).toBe("rooms");
    expect(entity.geometry.kind).toBe("polygon");
    if (entity.geometry.kind === "polygon") {
      expect(entity.geometry.points).toHaveLength(4);
    }
    expect(entity.label).toBe("Bedroom");
    expect(entity.attributes.roomType).toBe("bedroom");
  });
});
