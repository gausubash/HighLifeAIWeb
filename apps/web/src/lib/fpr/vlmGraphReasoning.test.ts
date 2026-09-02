import { describe, expect, it } from "vitest";
import { SCENE_GRAPH_SCHEMA_VERSION, type FloorPlanSceneGraph } from "@highlife/shared-types";
import { buildVlmGraphPrompt, vlmMustNotInventMetres } from "./vlmGraphReasoning";

function graph(): FloorPlanSceneGraph {
  return {
    schemaVersion: SCENE_GRAPH_SCHEMA_VERSION,
    id: "g",
    projectId: "p",
    planDocumentId: "d",
    pageId: "pg",
    analysisRunId: "a",
    coordinateSystems: ["original_image_px"],
    workingToOriginal: { scaleX: 1, scaleY: 1, translateX: 0, translateY: 0 },
    calibration: null,
    entities: [],
    relationships: [],
    measurements: [
      {
        id: "m1",
        kind: "room_area",
        sourceGeometryIds: ["r1"],
        calibrationId: "c",
        valueM2: 12.4,
        unit: "m2",
        precision: 1,
        confidence: 0.8,
        estimated: false,
      },
    ],
    createdAt: "",
    updatedAt: "",
  };
}

describe("vlmGraphReasoning", () => {
  it("builds a graph-only prompt", () => {
    const p = buildVlmGraphPrompt(graph());
    expect(p.system).toMatch(/scene graph/i);
    expect(p.user).toContain("12.4");
    expect(p.user).not.toMatch(/data:image/);
  });

  it("flags invented metres", () => {
    expect(vlmMustNotInventMetres("Living is 99.0 m2", graph()).length).toBeGreaterThan(0);
    expect(vlmMustNotInventMetres("Living is 12.4 m2", graph())).toEqual([]);
  });
});
