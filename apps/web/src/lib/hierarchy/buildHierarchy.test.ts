import { describe, expect, it } from "vitest";
import { buildHierarchyFromOverlays } from "./buildHierarchy";

describe("buildHierarchyFromOverlays", () => {
  it("adds title-block OCR units when no detections exist", () => {
    const hierarchy = buildHierarchyFromOverlays({
      analysisId: "a1",
      projectId: "p1",
      buildingName: "Tower A",
      pages: [
        {
          pageId: "pg1",
          pageNumber: 1,
          levelName: "First Floor Plan",
          levelIndex: 1,
          isFloorPlan: true,
          ocrUnitIds: ["101"],
        },
      ],
      entitiesByPage: { 1: [] },
    });

    expect(hierarchy.name).toBe("Tower A");
    expect(hierarchy.floors[0]?.levelName).toBe("First Floor Plan");
    expect(hierarchy.units.map((u) => u.label)).toEqual(["Unit 101"]);
    expect(hierarchy.units.every((u) => u.id.startsWith("ocr-unit-"))).toBe(true);
  });

  it("merges OCR units alongside detected unit boundaries", () => {
    const hierarchy = buildHierarchyFromOverlays({
      analysisId: "a1",
      projectId: "p1",
      buildingName: "Tower A",
      pages: [
        {
          pageId: "pg1",
          pageNumber: 1,
          levelName: "Second Floor",
          levelIndex: 2,
          isFloorPlan: true,
          ocrUnitIds: ["6A"],
        },
      ],
      entitiesByPage: {
        1: [
          {
            id: "u-detect",
            type: "unit_boundary",
            label: "Unit 5A",
            confidence: 0.9,
            status: "active",
            geometry: {
              kind: "rect",
              x: 0,
              y: 0,
              width: 100,
              height: 100,
            },
          },
        ],
      },
    });

    expect(hierarchy.units.map((u) => u.label)).toEqual(["Unit 5A", "Unit 6A"]);
  });

  it("orders units by unit number increasing", () => {
    const hierarchy = buildHierarchyFromOverlays({
      analysisId: "a1",
      projectId: "p1",
      buildingName: "Tower A",
      pages: [
        {
          pageId: "pg1",
          pageNumber: 1,
          levelName: "Level 1",
          levelIndex: 1,
          isFloorPlan: true,
          ocrUnitIds: ["101", "10", "2", "10A"],
        },
      ],
      entitiesByPage: { 1: [] },
    });

    expect(hierarchy.units.map((u) => u.label)).toEqual([
      "Unit 2",
      "Unit 10",
      "Unit 10A",
      "Unit 101",
    ]);
    expect(hierarchy.floors[0]?.unitIds).toEqual(hierarchy.units.map((u) => u.id));
  });
});
