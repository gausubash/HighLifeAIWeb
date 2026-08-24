import { describe, expect, it } from "vitest";
import { clampPanToViewport, clampZoom } from "./viewBounds";

describe("clampZoom", () => {
  it("does not zoom out smaller than fit (1)", () => {
    expect(clampZoom(0.5)).toBe(1);
  });

  it("caps zoom in", () => {
    expect(clampZoom(9)).toBe(5);
  });
});

describe("clampPanToViewport", () => {
  it("locks pan at fit zoom when page fits the box", () => {
    expect(clampPanToViewport(40, -20, 1, 800, 600, 1000, 800)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("allows pan only within overflow when zoomed in", () => {
    // stage 800x600 at zoom 2 → 1600x1200; view 1000x800 → max ±300, ±200
    const clamped = clampPanToViewport(999, -999, 2, 800, 600, 1000, 800);
    expect(clamped.x).toBe(300);
    expect(clamped.y).toBe(-200);
  });
});
