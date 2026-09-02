import { describe, expect, it } from "vitest";
import { entitiesInRect, hitTestGeometry, pointInPolygon } from "./geometry";
import type { OverlayEntity } from "./types";

function fakeEntity(id: string, x: number, y: number, width: number, height: number): OverlayEntity {
  return {
    id,
    type: "room",
    layer: "rooms",
    geometry: { kind: "rect", x, y, width, height },
    label: id,
    confidence: 1,
    status: "accepted",
    source: "model",
    attributes: {},
    createdAt: "",
    updatedAt: "",
  };
}

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

  it("selects overlays whose boxes meet a marquee", () => {
    const a = fakeEntity("a", 10, 10, 20, 20);
    const b = fakeEntity("b", 80, 80, 10, 10);
    const hit = entitiesInRect([a, b], { x: 15, y: 15, width: 30, height: 30 });
    expect(hit.map((e) => e.id)).toEqual(["a"]);
  });
});
