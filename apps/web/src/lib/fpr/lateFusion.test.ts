import { describe, expect, it } from "vitest";
import type { OverlayEntity } from "@/features/plan-editor/types";
import { buildLateFusionGraph } from "./lateFusion";

function poly(id: string, type: OverlayEntity["type"], x: number): OverlayEntity {
  return {
    id,
    type,
    layer: "rooms",
    label: id,
    confidence: 1,
    status: "predicted",
    source: "model",
    attributes: {},
    createdAt: "",
    updatedAt: "",
    geometry: {
      kind: "polygon",
      points: [
        { x, y: 0 },
        { x: x + 20, y: 0 },
        { x: x + 20, y: 20 },
        { x, y: 20 },
      ],
    },
  };
}

describe("buildLateFusionGraph", () => {
  it("links a room inside a unit and a door to that room", () => {
    const graph = buildLateFusionGraph({
      analysisId: "a",
      projectId: "p",
      pageId: "1",
      entities: [poly("u1", "unit_boundary", 0), poly("r1", "room", 2), poly("d1", "door", 8)],
      pixelsPerMeter: 10,
    });
    expect(graph.relationships.some((r) => r.type === "unit_contains_room")).toBe(true);
    expect(graph.relationships.some((r) => r.type === "room_door_access")).toBe(true);
    expect(graph.calibration?.mmPerPixel).toBeCloseTo(100);
    expect(graph.measurements.length).toBeGreaterThan(0);
  });
});
