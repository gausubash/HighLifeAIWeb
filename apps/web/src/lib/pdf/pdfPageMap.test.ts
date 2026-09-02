import { describe, expect, it } from "vitest";
import { mapPdfViewportToPage } from "./pdfPageMap";

describe("mapPdfViewportToPage", () => {
  it("scales PDF points onto a 300 DPI page raster", () => {
    // A3 landscape at 72 pt → 300 DPI is 4.166…×
    const mapped = mapPdfViewportToPage(100, 50, 1191, 842, 4961, 3508);
    expect(mapped.x).toBeCloseTo(100 * (4961 / 1191), 5);
    expect(mapped.y).toBeCloseTo(50 * (3508 / 842), 5);
  });

  it("is identity when viewport already matches the page", () => {
    expect(mapPdfViewportToPage(12, 8, 800, 600, 800, 600)).toEqual({ x: 12, y: 8 });
  });
});
