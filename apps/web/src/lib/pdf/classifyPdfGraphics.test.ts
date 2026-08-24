import { describe, expect, it } from "vitest";
import { classifyPdfGraphics, countPdfOperators, pdfGraphicsLabel } from "./classifyPdfGraphics";

const OPS = {
  constructPath: 1,
  stroke: 2,
  fill: 3,
  paintImageXObject: 10,
  showText: 20,
};

describe("classifyPdfGraphics", () => {
  it("labels CAD-style path pages as vector", () => {
    const info = classifyPdfGraphics({ vectorOps: 400, imageOps: 0, textOps: 12 });
    expect(info.kind).toBe("vector");
    expect(pdfGraphicsLabel(info.kind)).toBe("Vector PDF");
  });

  it("labels image-heavy scans as raster", () => {
    const info = classifyPdfGraphics({ vectorOps: 2, imageOps: 1, textOps: 0 });
    expect(info.kind).toBe("raster");
  });

  it("labels mixed pages as hybrid", () => {
    const info = classifyPdfGraphics({ vectorOps: 80, imageOps: 3, textOps: 4 });
    expect(info.kind).toBe("hybrid");
  });

  it("does not guess vector when no operators were found", () => {
    const info = classifyPdfGraphics({ vectorOps: 0, imageOps: 0, textOps: 0 });
    expect(info.kind).toBe("unknown");
  });
});

describe("countPdfOperators", () => {
  it("counts vector, image, and text ops from pdf.js fnArray", () => {
    const counts = countPdfOperators([1, 2, 2, 10, 20, 20, 3], OPS);
    expect(counts).toEqual({ vectorOps: 4, imageOps: 1, textOps: 2 });
  });
});
