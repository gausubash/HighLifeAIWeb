import { describe, expect, it } from "vitest";
import {
  calibrateFromScaleAndPaper,
  calibrateFromTwoPoints,
  computeScaleInfo,
  inferPaperSizeFromPoints,
  parseScaleAndPaper,
  parseScaleRatio,
  pixelDistance,
  pixelsPerMeterFromScaleAndPaper,
} from "@/lib/scale/parseScale";

describe("parseScaleAndPaper", () => {
  it("parses standard title block declarations", () => {
    expect(parseScaleAndPaper("DRAWING SCALE 1:200 @ A3")).toEqual({
      scale: 200,
      paper: "A3",
    });
    expect(parseScaleAndPaper("scale 1:100 @ a4")).toEqual({
      scale: 100,
      paper: "A4",
    });
    expect(parseScaleAndPaper("1:200@A3")).toEqual({ scale: 200, paper: "A3" });
  });

  it("tolerates OCR noise", () => {
    expect(parseScaleAndPaper("SCALE l:200 @ A3")).toEqual({ scale: 200, paper: "A3" });
    expect(parseScaleAndPaper("Scale 1.200 @ A 3")).toEqual({ scale: 200, paper: "A3" });
    expect(parseScaleAndPaper("SCALE 1:200 @ A3J")).toEqual({ scale: 200, paper: "A3" });
  });
});

describe("parseScaleRatio", () => {
  it("parses bare scale ratios", () => {
    expect(parseScaleRatio("DRAWING SCALE 1:100")).toBe(100);
    expect(parseScaleRatio("Scale l:200")).toBe(200);
  });
});

describe("inferPaperSizeFromPoints", () => {
  it("matches A3 from PDF points", () => {
    const ptPerMm = 72 / 25.4;
    const match = inferPaperSizeFromPoints(420 * ptPerMm, 297 * ptPerMm);
    expect(match?.name).toBe("A3");
  });
});

describe("computeScaleInfo", () => {
  it("derives scale from title block text", () => {
    const info = computeScaleInfo({
      scaleText: "Scale 1:200 @ A3",
      pageWidthPt: 1190,
      pageHeightPt: 842,
      renderWidthPx: 2380,
      renderHeightPx: 1684,
      renderScale: 2,
    });

    expect(info.scaleRatio).toBe(200);
    expect(info.paper).toBe("A3");
    expect(info.method).toBe("title_block_text");
    expect(info.confidence).toBeGreaterThanOrEqual(0.9);
    expect(info.pixelsPerMeter).not.toBeNull();
  });

  it("falls back to paper size when no scale text", () => {
    const info = computeScaleInfo({
      scaleText: "",
      pageWidthPt: 595,
      pageHeightPt: 842,
      renderWidthPx: 1190,
      renderHeightPx: 1684,
      renderScale: 2,
    });

    expect(info.scaleRatio).toBeNull();
    expect(info.method).toBe("paper_size_auto");
    expect(info.paperFromPdf).not.toBeNull();
  });
});

describe("calibrateFromTwoPoints", () => {
  it("computes pixelsPerMeter from two points and a known length", () => {
    expect(pixelDistance({ x: 0, y: 0 }, { x: 300, y: 400 })).toBe(500);

    const base = computeScaleInfo({
      scaleText: "",
      pageWidthPt: 1190,
      pageHeightPt: 842,
      renderWidthPx: 2380,
      renderHeightPx: 1684,
      renderScale: 2,
    });

    // 500 px spans 5 m → 100 px/m
    const calibrated = calibrateFromTwoPoints(base, {
      pointA: { x: 0, y: 0 },
      pointB: { x: 300, y: 400 },
      realLength: 5,
      realUnit: "m",
    });

    expect(calibrated.method).toBe("manual_two_point");
    expect(calibrated.pixelsPerMeter).toBeCloseTo(100, 5);
    expect(calibrated.confidence).toBe(0.99);
  });

  it("accepts millimetres", () => {
    const base = computeScaleInfo({
      scaleText: "Scale 1:100 @ A3",
      pageWidthPt: 1190,
      pageHeightPt: 842,
      renderWidthPx: 2380,
      renderHeightPx: 1684,
      renderScale: 2,
    });

    // 200 px = 1000 mm = 1 m → 200 px/m
    const calibrated = calibrateFromTwoPoints(base, {
      pointA: { x: 10, y: 10 },
      pointB: { x: 210, y: 10 },
      realLength: 1000,
      realUnit: "mm",
    });

    expect(calibrated.pixelsPerMeter).toBeCloseTo(200, 5);
  });
});

describe("calibrateFromScaleAndPaper", () => {
  it("maps 1:200 @ A3 landscape onto rendered pixels", () => {
    // A3 landscape = 420 mm wide. 1:200 → 0.42 * 200 = 84 m across the sheet.
    const ppm = pixelsPerMeterFromScaleAndPaper({
      scaleRatio: 200,
      paper: "A3",
      renderWidthPx: 4200,
      renderHeightPx: 2970,
    });
    expect(ppm).toBeCloseTo(4200 / 84, 5);

    const base = computeScaleInfo({
      scaleText: "",
      pageWidthPt: 1190,
      pageHeightPt: 842,
      renderWidthPx: 4200,
      renderHeightPx: 2970,
      renderScale: 2,
    });
    const next = calibrateFromScaleAndPaper(base, {
      scaleRatio: 200,
      paper: "A3",
      renderWidthPx: 4200,
      renderHeightPx: 2970,
    });
    expect(next.method).toBe("manual_scale_paper");
    expect(next.scaleRatio).toBe(200);
    expect(next.paper).toBe("A3");
    expect(next.pixelsPerMeter).toBeCloseTo(ppm, 5);
  });
});

describe("lengthFromPixels", () => {
  it("converts px back to metres using calibration", async () => {
    const { lengthFromPixels, formatMeasuredLength } = await import("@/lib/scale/parseScale");
    const { meters, millimetres } = lengthFromPixels(500, 100);
    expect(meters).toBeCloseTo(5, 5);
    expect(millimetres).toBeCloseTo(5000, 5);
    expect(formatMeasuredLength(5)).toBe("5.000 m");
    expect(formatMeasuredLength(0.45)).toBe("450.0 mm");
  });
});
