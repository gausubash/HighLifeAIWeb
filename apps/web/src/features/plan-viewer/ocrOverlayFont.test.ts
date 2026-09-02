import { describe, expect, it } from "vitest";
import {
  clampOcrOverlayFontSize,
  formatOcrClassLabel,
  ocrLabelAboveQuad,
  ocrOverlayFontSize,
  ocrTextAlongQuad,
} from "./ocrOverlayFont";

describe("ocrOverlayFontSize", () => {
  it("defaults to 10px and accepts an override", () => {
    expect(ocrOverlayFontSize(400, 90, "TITLE", 2480)).toBe(10);
    expect(ocrOverlayFontSize(80, 16, "N", 2480, 18)).toBe(18);
    expect(ocrOverlayFontSize(30, 10, "A1", 2480, 6)).toBe(6);
  });

  it("clamps overlay type size", () => {
    expect(clampOcrOverlayFontSize(1)).toBe(4);
    expect(clampOcrOverlayFontSize(99)).toBe(48);
  });
});

describe("ocrTextAlongQuad", () => {
  it("starts at the first corner with no extra offset", () => {
    expect(
      ocrTextAlongQuad([
        { x: 40, y: 80 },
        { x: 140, y: 80 },
      ]),
    ).toEqual({ x: 40, y: 80, rotate: 0 });
  });

  it("follows a rotated box edge", () => {
    const place = ocrTextAlongQuad([
      { x: 10, y: 10 },
      { x: 10, y: 40 },
    ]);
    expect(place.x).toBe(10);
    expect(place.y).toBe(10);
    expect(place.rotate).toBeCloseTo(90);
  });
});

describe("ocrLabelAboveQuad", () => {
  it("uses the screen-space top edge, not the first Paddle corner", () => {
    const clockwise = ocrLabelAboveQuad(
      [
        { x: 10, y: 20 },
        { x: 80, y: 20 },
        { x: 80, y: 40 },
        { x: 10, y: 40 },
      ],
      8,
    );
    expect(clockwise.x).toBe(10);
    expect(clockwise.y).toBe(12);
    expect(clockwise.rotate).toBe(0);

    const paddleFromBottomRight = ocrLabelAboveQuad(
      [
        { x: 80, y: 40 },
        { x: 10, y: 40 },
        { x: 10, y: 20 },
        { x: 80, y: 20 },
      ],
      8,
    );
    expect(paddleFromBottomRight.x).toBe(10);
    expect(paddleFromBottomRight.y).toBe(12);
    expect(paddleFromBottomRight.rotate).toBe(0);
  });
});

describe("formatOcrClassLabel", () => {
  it("appends a CV-style confidence percent", () => {
    expect(formatOcrClassLabel("SK05", 0.924)).toBe("SK05  92%");
    expect(formatOcrClassLabel("APT 203")).toBe("APT 203");
  });
});
