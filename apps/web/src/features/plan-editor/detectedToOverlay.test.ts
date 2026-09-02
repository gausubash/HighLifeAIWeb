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

  it("canonicalizes uppercase LIVING to Open Living", () => {
    const entity = detectedRegionToOverlay({
      id: "reg-liv",
      type: "room",
      label: "LIVING",
      confidence: 0.7,
      polygonPx: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      bboxPx: { x: 0, y: 0, width: 10, height: 10 },
      attributes: {},
    });
    expect(entity.label).toBe("Open Living");
  });

  it("stamps headingDeg on a north arrow from its long axis", () => {
    const entity = detectedRegionToOverlay({
      id: "n1",
      type: "north_arrow",
      label: "North Arrow",
      confidence: 0.9,
      polygonPx: [
        { x: 0, y: 0 },
        { x: 0, y: -20 },
        { x: 4, y: -20 },
        { x: 4, y: 0 },
      ],
      bboxPx: { x: 0, y: -20, width: 4, height: 20 },
      attributes: {},
    });
    expect(entity.type).toBe("north_arrow");
    expect(typeof entity.attributes.headingDeg).toBe("number");
    expect(entity.attributes.keypoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "tip" }),
        expect.objectContaining({ name: "base" }),
      ]),
    );
  });

  it("maps a Unit detection to unit_boundary even when the API types it as a room", () => {
    const entity = detectedRegionToOverlay({
      id: "u1",
      type: "room",
      label: "Unit",
      confidence: 0.9,
      polygonPx: [
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 40 },
        { x: 0, y: 40 },
      ],
      bboxPx: { x: 0, y: 0, width: 40, height: 40 },
      attributes: {},
    });
    expect(entity.type).toBe("unit_boundary");
    expect(entity.label).toBe("Unit");
  });

  it("keeps Roboflow tip/base visibility on a north arrow", () => {
    const entity = detectedRegionToOverlay({
      id: "n2",
      type: "north_arrow",
      label: "Compass",
      confidence: 0.88,
      polygonPx: [
        { x: 8, y: 8 },
        { x: 12, y: 8 },
        { x: 12, y: 40 },
        { x: 8, y: 40 },
      ],
      bboxPx: { x: 8, y: 8, width: 4, height: 32 },
      attributes: {
        keypoints: [
          { class: "base", x: 10, y: 38, visibility: 2 },
          { class: "tip", x: 10, y: 10, visibility: 0 },
        ],
      },
    });
    const keypoints = entity.attributes.keypoints as Array<{ name: string; visibility: string }>;
    expect(keypoints.find((k) => k.name === "tip")?.visibility).toBe("not_labeled");
    expect(keypoints.find((k) => k.name === "base")?.visibility).toBe("visible");
    expect(typeof entity.attributes.headingDeg).toBe("number");
  });
});
