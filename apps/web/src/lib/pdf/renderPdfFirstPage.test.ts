import { describe, expect, it } from "vitest";
import {
  PDF_RENDER_DPI,
  clampPdfUploadDpi,
  pdfRenderScale,
} from "./renderPdfFirstPage";

describe("clampPdfUploadDpi", () => {
  it("clamps upload DPI to supported range", () => {
    expect(clampPdfUploadDpi(300)).toBe(300);
    expect(clampPdfUploadDpi(1500)).toBe(1200);
    expect(clampPdfUploadDpi(50)).toBe(150);
    expect(clampPdfUploadDpi(Number.NaN)).toBe(PDF_RENDER_DPI);
  });

  it("derives pdf.js scale from DPI", () => {
    expect(pdfRenderScale(300)).toBeCloseTo(300 / 72);
  });
});
