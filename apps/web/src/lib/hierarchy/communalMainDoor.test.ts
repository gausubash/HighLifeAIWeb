import { describe, expect, it } from "vitest";
import {
  buildCommunalSeedPoints,
  classifyMainDoorsByWidth,
  classifyMainDoorsFromCommunal,
  classifyUnitEntranceDoors,
  communalRegionCentroid,
  doorOpeningSpanFromPoints,
  doorOpeningSpanFromRect,
  doorOpeningSpanPx,
  inferCorridorSeedsFromDoors,
  minDistToPolygon,
  nearCommunalRegion,
  unitSeedBehindMainDoor,
} from "./communalMainDoor";
describe("communalMainDoor", () => {
  it("measures opening width as the shorter rect side", () => {
    expect(doorOpeningSpanPx({ x0: 0, y0: 0, x1: 40, y1: 8 })).toBe(8);
    expect(doorOpeningSpanFromRect(40, 8)).toBe(8);
    expect(doorOpeningSpanFromRect(8, 40)).toBe(8);
  });

  it("uses the shortest edge on four-corner door quads", () => {
    const quad = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 6 },
      { x: 0, y: 6 },
    ];
    expect(doorOpeningSpanFromPoints(quad)).toBe(6);
  });

  it("falls back to min bbox side for irregular polygons", () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 20, y: 2 },
      { x: 18, y: 10 },
      { x: 1, y: 8 },
      { x: 5, y: 4 },
    ];
    expect(doorOpeningSpanFromPoints(poly)).toBeCloseTo(10, 0);
  });

  it("classifies doors near communal flood as main entrances", () => {
    const communalPolys = [
      [
        { x: 80, y: 0 },
        { x: 120, y: 0 },
        { x: 120, y: 30 },
        { x: 80, y: 30 },
      ],
    ];
    const mains = classifyMainDoorsFromCommunal(
      [
        { id: "d-main", label: "Door", centroid: { x: 90, y: 32 }, spanPx: 18 },
        { id: "d-int", label: "Door", centroid: { x: 40, y: 80 }, spanPx: 10 },
        { id: "d-yolo", label: "Main Door", centroid: { x: 150, y: 80 }, spanPx: 10 },
      ],
      communalPolys,
      8,
    );
    expect(mains.has("d-main")).toBe(true);
    expect(mains.has("d-int")).toBe(false);
    expect(mains.has("d-yolo")).toBe(true);
  });

  it("seeds unit flood behind the door away from communal centroid", () => {
    const communal = communalRegionCentroid([
      [
        { x: 90, y: 10 },
        { x: 110, y: 10 },
        { x: 110, y: 20 },
        { x: 90, y: 20 },
      ],
    ]);
    const seed = unitSeedBehindMainDoor({ x: 100, y: 30 }, communal, 16);
    expect(seed.y).toBeGreaterThan(30);
  });

  it("measures distance to polygon edges", () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(minDistToPolygon({ x: 50, y: 50 }, poly)).toBe(0);
    expect(minDistToPolygon({ x: 50, y: -5 }, poly)).toBeCloseTo(5, 0);
    expect(nearCommunalRegion({ x: 50, y: -4 }, [poly], 5)).toBe(true);
  });

  it("seeds corridor flood from wide aligned entrance doors", () => {
    const doors = [
      { id: "d-a", label: "Door", centroid: { x: 44, y: 34 }, spanPx: 18 },
      { id: "d-b", label: "Door", centroid: { x: 140, y: 34 }, spanPx: 18 },
      { id: "d-int", label: "Door", centroid: { x: 44, y: 110 }, spanPx: 10 },
    ];
    const seeds = inferCorridorSeedsFromDoors(doors, 8);
    expect(seeds.length).toBeGreaterThan(0);
    expect(seeds.some((s) => s.y < 34)).toBe(true);
  });

  it("treats wider openings as unit main doors", () => {
    const doors = [
      { id: "main-a", label: "Door", centroid: { x: 44, y: 34 }, spanPx: 20 },
      { id: "main-b", label: "Door", centroid: { x: 140, y: 34 }, spanPx: 19 },
      { id: "int-a", label: "Door", centroid: { x: 44, y: 110 }, spanPx: 10 },
      { id: "int-b", label: "Door", centroid: { x: 140, y: 110 }, spanPx: 11 },
    ];
    const mains = classifyMainDoorsByWidth(doors);
    expect(mains.has("main-a")).toBe(true);
    expect(mains.has("main-b")).toBe(true);
    expect(mains.has("int-a")).toBe(false);
    expect(mains.has("int-b")).toBe(false);
  });

  it("uses a fixed min span in threshold mode", () => {
    const doors = [
      { id: "main-a", label: "Door", centroid: { x: 44, y: 34 }, spanPx: 20 },
      { id: "main-b", label: "Door", centroid: { x: 140, y: 34 }, spanPx: 15 },
      { id: "int-a", label: "Door", centroid: { x: 44, y: 110 }, spanPx: 10 },
    ];
    const mains = classifyMainDoorsByWidth(doors, { mode: "threshold", minSpanPx: 16 });
    expect(mains.has("main-a")).toBe(true);
    expect(mains.has("main-b")).toBe(false);
    expect(mains.has("int-a")).toBe(false);
  });

  it("classifies entrance doors via width and communal spine", () => {
    const communalPolys = [
      [
        { x: 80, y: 0 },
        { x: 120, y: 0 },
        { x: 120, y: 28 },
        { x: 80, y: 28 },
      ],
    ];
    const doors = [
      { id: "d-main", label: "Door", centroid: { x: 90, y: 30 }, spanPx: 18 },
      { id: "d-int", label: "Door", centroid: { x: 44, y: 110 }, spanPx: 10 },
    ];
    const mains = classifyUnitEntranceDoors(doors, communalPolys, 6);
    expect(mains.has("d-main")).toBe(true);
    expect(mains.has("d-int")).toBe(false);
  });
});
