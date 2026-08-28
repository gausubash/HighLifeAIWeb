import { describe, expect, it } from "vitest";
import { clampOcrDpi, PDF_OCR_DPI, scaleSheetOcrMeta } from "./ocrClient";

describe("scaleSheetOcrMeta", () => {
  it("scales OCR line boxes from high-DPI raster to viewer page size", () => {
    const sheet = {
      lines: [
        {
          text: "1:100",
          confidence: 0.9,
          bbox: [
            [0, 0],
            [1200, 0],
            [1200, 120],
            [0, 120],
          ],
        },
      ],
    };
    const scaled = scaleSheetOcrMeta(sheet, 12000, 8400, 3000, 2100);
    expect(scaled.lines?.[0]?.bbox?.[1]?.[0]).toBe(300);
    expect(scaled.lines?.[0]?.bbox?.[2]?.[1]).toBe(30);
  });

  it("uses 300 DPI default for PDF OCR", () => {
    expect(PDF_OCR_DPI).toBe(300);
    expect(clampOcrDpi(1200)).toBe(1200);
    expect(clampOcrDpi(850)).toBe(850);
    expect(clampOcrDpi(9999)).toBe(2400);
    expect(clampOcrDpi(Number.NaN)).toBe(300);
  });
});
