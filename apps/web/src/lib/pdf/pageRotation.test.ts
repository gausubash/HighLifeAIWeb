import { describe, expect, it } from "vitest";
import {
  normalizeRotation,
  rotateGeometry,
  rotatePoint,
  rotatedSize,
} from "./pageRotation";

describe("pageRotation", () => {
  it("normalizes angles onto 90° steps", () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(0)).toBe(0);
  });

  it("swaps width and height for quarter turns", () => {
    expect(rotatedSize(200, 100, 90)).toEqual({ width: 100, height: 200 });
    expect(rotatedSize(200, 100, 180)).toEqual({ width: 200, height: 100 });
  });

  it("maps the top-left corner around a 90° clockwise turn", () => {
    expect(rotatePoint(0, 0, 200, 100, 90)).toEqual({ x: 100, y: 0 });
    expect(rotatePoint(200, 0, 200, 100, 90)).toEqual({ x: 100, y: 200 });
    expect(rotatePoint(0, 0, 200, 100, 180)).toEqual({ x: 200, y: 100 });
    expect(rotatePoint(0, 0, 200, 100, 270)).toEqual({ x: 0, y: 200 });
  });

  it("rotates rectangles by transforming opposite corners", () => {
    const next = rotateGeometry(
      { kind: "rect", x: 10, y: 20, width: 40, height: 10 },
      200,
      100,
      90,
    );
    expect(next).toEqual({ kind: "rect", x: 70, y: 10, width: 10, height: 40 });
  });

  it("rotates polygon vertices", () => {
    const next = rotateGeometry(
      {
        kind: "polygon",
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 5 },
        ],
      },
      20,
      10,
      180,
    );
    expect(next.kind).toBe("polygon");
    if (next.kind === "polygon") {
      expect(next.points).toEqual([
        { x: 20, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 5 },
      ]);
    }
  });
});
