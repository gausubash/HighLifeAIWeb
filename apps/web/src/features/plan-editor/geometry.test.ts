import { describe, expect, it } from "vitest";
import { hitTestGeometry, pointInPolygon } from "./geometry";

describe("overlay hit tests", () => {
  it("detects a point inside a polygon", () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon({ x: 5, y: 5 }, poly)).toBe(true);
    expect(pointInPolygon({ x: 20, y: 5 }, poly)).toBe(false);
  });

  it("hits a polyline within tolerance", () => {
    const geometry = {
      kind: "polyline" as const,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    };
    expect(hitTestGeometry({ x: 50, y: 3 }, geometry, 5)).toBe(true);
    expect(hitTestGeometry({ x: 50, y: 20 }, geometry, 5)).toBe(false);
  });

  it("hits a rect", () => {
    const geometry = { kind: "rect" as const, x: 10, y: 10, width: 20, height: 30 };
    expect(hitTestGeometry({ x: 15, y: 20 }, geometry, 2)).toBe(true);
    expect(hitTestGeometry({ x: 0, y: 0 }, geometry, 2)).toBe(false);
  });
});
