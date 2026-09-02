import { describe, expect, it } from "vitest";
import { resolveNorthDetectCrop } from "./northCropScope";

const title = { x: 0.7, y: 0.8, width: 0.25, height: 0.15 };
const drawing = { x: 0.05, y: 0.05, width: 0.7, height: 0.7 };

describe("resolveNorthDetectCrop", () => {
  it("pads the title-block crop so nearby compasses stay in view", () => {
    const next = resolveNorthDetectCrop("title", { title, drawing });
    expect(next.used).toBe("title");
    expect(next.crop).not.toBeNull();
    expect(next.crop!.width).toBeGreaterThan(title.width);
    expect(next.crop!.height).toBeGreaterThan(title.height);
    expect(next.warning).toBeNull();
  });

  it("uses the drawing crop when asked", () => {
    const next = resolveNorthDetectCrop("drawing", { title, drawing });
    expect(next).toEqual({ crop: drawing, used: "drawing", warning: null });
  });

  it("searches the whole page when asked", () => {
    expect(resolveNorthDetectCrop("page", { title, drawing })).toEqual({
      crop: null,
      used: "page",
      warning: null,
    });
  });

  it("falls back to the page with a warning when the layout box is missing", () => {
    const missingTitle = resolveNorthDetectCrop("title", { title: null, drawing });
    expect(missingTitle.crop).toBeNull();
    expect(missingTitle.used).toBe("page");
    expect(missingTitle.warning).toMatch(/title block/i);

    const missingDrawing = resolveNorthDetectCrop("drawing", { title, drawing: null });
    expect(missingDrawing.crop).toBeNull();
    expect(missingDrawing.used).toBe("page");
    expect(missingDrawing.warning).toMatch(/drawing area/i);
  });
});
