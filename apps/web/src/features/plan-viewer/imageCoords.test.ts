import { describe, expect, it } from "vitest";
import { clientToImagePixels, loupeImageStyle } from "./imageCoords";

describe("clientToImagePixels", () => {
  const display = { left: 100, top: 50, width: 500, height: 250 };

  it("maps corners of the display to image corners", () => {
    expect(clientToImagePixels(100, 50, display, 2000, 1000)).toEqual({ x: 0, y: 0 });
    expect(clientToImagePixels(600, 300, display, 2000, 1000)).toEqual({
      x: 2000,
      y: 1000,
    });
  });

  it("maps the display centre to the image centre", () => {
    const pt = clientToImagePixels(350, 175, display, 2000, 1000);
    expect(pt?.x).toBeCloseTo(1000);
    expect(pt?.y).toBeCloseTo(500);
  });

  it("returns null outside the image", () => {
    expect(clientToImagePixels(50, 50, display, 2000, 1000)).toBeNull();
  });
});

describe("loupeImageStyle", () => {
  it("centres the loupe on the cursor image point", () => {
    const loupeSize = 160;
    const style = loupeImageStyle(1000, 500, 2000, 1000, 500, 250, loupeSize, 4);
    // Magnified display: 2000 x 1000
    expect(style.width).toBe(2000);
    expect(style.height).toBe(1000);
    // Point (1000,500) in image → centre of magnified image at loupe centre
    expect(style.left + (1000 / 2000) * style.width).toBeCloseTo(loupeSize / 2);
    expect(style.top + (500 / 1000) * style.height).toBeCloseTo(loupeSize / 2);
  });
});
