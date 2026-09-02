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

  it("treats Apartment 17 and Unit 17 as the same unit", () => {
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
          ocrUnitIds: ["17"],
        },
      ],
      entitiesByPage: {
        1: [
          {
            id: "u-17",
            type: "unit_boundary",
            label: "Apartment 17",
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

    expect(hierarchy.units.map((u) => u.label)).toEqual(["Apartment 17"]);
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

  it("nests geometry rooms under the unit they already belong to", () => {
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
        },
      ],
      entitiesByPage: {
        1: [
          {
            id: "u-37",
            type: "unit_boundary",
            label: "Unit 37",
            confidence: 0.9,
            status: "active",
            geometry: { kind: "rect", x: 0, y: 0, width: 200, height: 200 },
          },
        ],
      },
      geometryRoomsByPage: {
        1: [
          {
            id: "living-1",
            label: "Living",
            unitId: "u-37",
            unitLabel: "Unit 37",
            isCommon: false,
            points: [
              { x: 10, y: 10 },
              { x: 80, y: 10 },
              { x: 80, y: 80 },
              { x: 10, y: 80 },
            ],
            areaPx2: 4900,
            widthPx: 70,
            depthPx: 70,
            perimeterPx: 280,
            areaM2: 12,
            widthM: 3,
            depthM: 3,
            perimeterM: 12,
            adjacentIds: [],
            adjacentLabels: [],
            openings: { doors: [], windows: [] },
          },
          {
            id: "bed-1",
            label: "Bedroom",
            unitId: "u-37",
            unitLabel: "Unit 37",
            isCommon: false,
            points: [
              { x: 90, y: 10 },
              { x: 160, y: 10 },
              { x: 160, y: 80 },
              { x: 90, y: 80 },
            ],
            areaPx2: 4900,
            widthPx: 70,
            depthPx: 70,
            perimeterPx: 280,
            areaM2: 10,
            widthM: 3,
            depthM: 3,
            perimeterM: 12,
            adjacentIds: [],
            adjacentLabels: [],
            openings: { doors: [], windows: [] },
          },
        ],
      },
    });

    const unit = hierarchy.units.find((u) => u.id === "u-37");
    expect(unit?.roomIds).toEqual(["living-1", "bed-1"]);
    expect(unit?.bedroomCount).toBe(1);
    expect(hierarchy.rooms.map((r) => r.label)).toEqual(["Living", "Bedroom"]);
  });

  it("attaches geometry rooms to OCR units by label when there is no outline", () => {
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
          ocrUnitIds: ["12"],
        },
      ],
      entitiesByPage: { 1: [] },
      geometryRoomsByPage: {
        1: [
          {
            id: "living-12",
            label: "Living",
            unitId: null,
            unitLabel: "Unit 12",
            isCommon: false,
            points: [
              { x: 0, y: 0 },
              { x: 20, y: 0 },
              { x: 20, y: 20 },
              { x: 0, y: 20 },
            ],
            areaPx2: 400,
            widthPx: 20,
            depthPx: 20,
            perimeterPx: 80,
            areaM2: null,
            widthM: null,
            depthM: null,
            perimeterM: null,
            adjacentIds: [],
            adjacentLabels: [],
            openings: { doors: [], windows: [] },
          },
        ],
      },
    });

    const unit = hierarchy.units.find((u) => u.label === "Unit 12");
    expect(unit?.roomIds).toEqual(["living-12"]);
    expect(hierarchy.rooms[0]?.unitId).toBe(unit?.id);
  });
});
