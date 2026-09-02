import { describe, expect, it } from "vitest";
import {
  bearingFromNorth,
  cardinalFromBearing,
  headingFromGeometry,
  isOppositeOrPerpendicular,
  outwardPerpendicular,
  windowLongEdge,
} from "./apartmentAspect";

describe("windowLongEdge", () => {
  it("picks the longer side of a window rectangle", () => {
    const edge = windowLongEdge([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 8 },
      { x: 0, y: 8 },
    ]);
    expect(edge?.lengthPx).toBeCloseTo(40);
  });
});

describe("outwardPerpendicular", () => {
  it("points away from the unit centroid", () => {
    const n = outwardPerpendicular({ x: 40, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 });
    expect(n.y).toBeLessThan(0);
  });
});

describe("headingFromGeometry", () => {
  it("prefers stored headingDeg over the polygon axis", () => {
    expect(headingFromGeometry([{ x: 0, y: 0 }, { x: 10, y: 0 }], { headingDeg: 270 })).toBe(270);
  });

  it("uses Roboflow tip−base keypoints when heading is not stored", () => {
    expect(
      headingFromGeometry(
        [
          { x: 0, y: 0 },
          { x: 8, y: 0 },
        ],
        {
          keypoints: [
            { name: "base", x: 10, y: 40 },
            { name: "tip", x: 10, y: 10 },
          ],
        },
      ),
    ).toBeCloseTo(270, 5);
  });
});

describe("bearingFromNorth", () => {
  it("is 0 when the facade faces the same way as north", () => {
    expect(bearingFromNorth({ x: 0, y: -1 }, 270)).toBeCloseTo(0, 0);
  });

  it("maps 90° steps to cardinals", () => {
    expect(cardinalFromBearing(0)).toBe("N");
    expect(cardinalFromBearing(90)).toBe("E");
    expect(cardinalFromBearing(180)).toBe("S");
    expect(isOppositeOrPerpendicular(0, 90)).toBe(true);
    expect(isOppositeOrPerpendicular(0, 180)).toBe(true);
    expect(isOppositeOrPerpendicular(0, 20)).toBe(false);
  });
});
