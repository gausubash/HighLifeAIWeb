import { describe, expect, it } from "vitest";
import type { OverlayEntity } from "@/features/plan-editor/types";
import { computeMetricLayer, wallThicknessPx } from "./metricLayer";

function room(): OverlayEntity {
  return {
    id: "r1",
    type: "room",
    layer: "rooms",
    label: "Bedroom",
    confidence: 1,
    status: "predicted",
    source: "model",
    attributes: {},
    createdAt: "",
    updatedAt: "",
    geometry: {
      kind: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    },
  };
}

describe("computeMetricLayer", () => {
  it("leaves metres null without scale", () => {
    const rows = computeMetricLayer([room()], null);
    const area = rows.find((r) => r.kind === "room_area");
    expect(area?.valueM2).toBeNull();
    expect(area?.valuePx).toBe(100);
  });

  it("converts area with pixelsPerMeter", () => {
    const rows = computeMetricLayer([room()], 10);
    expect(rows.find((r) => r.kind === "room_area")?.valueM2).toBeCloseTo(1);
  });

  it("estimates wall thickness from ribbon area", () => {
    expect(
      wallThicknessPx([
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 2 },
        { x: 0, y: 2 },
      ]),
    ).toBeCloseTo(2, 5);
  });
});
