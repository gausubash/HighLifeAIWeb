import { describe, expect, it } from "vitest";
import {
  clampPanToViewport,
  clampZoom,
  panForZoomAtPoint,
  zoomDeltaFromButton,
  zoomDeltaFromWheel,
} from "./viewBounds";

describe("clampZoom", () => {
  it("does not zoom out smaller than fit (1)", () => {
    expect(clampZoom(0.5)).toBe(1);
  });

  it("caps zoom in at 1500%", () => {
    expect(clampZoom(15)).toBe(15);
    expect(clampZoom(20)).toBe(15);
  });
});

describe("zoom steps", () => {
  it("uses a larger wheel step with Alt", () => {
    expect(zoomDeltaFromWheel(false, -1)).toBe(1);
    expect(zoomDeltaFromWheel(true, -1)).toBe(3);
    expect(zoomDeltaFromWheel(true, 40)).toBe(-3);
  });

  it("uses a larger button step with Alt", () => {
    expect(zoomDeltaFromButton(false, 1)).toBe(1);
    expect(zoomDeltaFromButton(true, 1)).toBe(3);
    expect(zoomDeltaFromButton(true, -1)).toBe(-3);
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

describe("panForZoomAtPoint", () => {
  it("keeps existing pan when zooming at the viewport centre", () => {
    expect(panForZoomAtPoint(0, 0, 2, 3, 500, 400, 1000, 800)).toEqual({ x: 0, y: 0 });
  });

  it("pans so a point right of centre stays put when zooming in", () => {
    // viewport 1000×800; origin 200px right of centre; 2 → 3
    expect(panForZoomAtPoint(0, 0, 2, 3, 700, 400, 1000, 800)).toEqual({ x: -100, y: 0 });
  });

  it("reverses that pan when zooming back out", () => {
    const panned = panForZoomAtPoint(-100, 0, 3, 2, 700, 400, 1000, 800);
    expect(panned.x).toBeCloseTo(0);
    expect(panned.y).toBeCloseTo(0);
  });

  it("scales an existing pan when the origin is the viewport centre", () => {
    expect(panForZoomAtPoint(80, -40, 2, 3, 500, 400, 1000, 800)).toEqual({ x: 120, y: -60 });
  });
});
