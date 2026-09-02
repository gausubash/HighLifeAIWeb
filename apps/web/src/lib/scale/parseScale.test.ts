import { describe, expect, it } from "vitest";
import {
  calibrateFromScaleAndPaper,
  calibrateFromTwoPoints,
  computeScaleInfo,
  inferPaperSizeFromPoints,
  parseScaleAndPaper,
  parseScaleRatio,
  parsePaperFromText,
  canonicalScaleText,
  pixelDistance,
  pixelsPerMeterFromScaleAndPaper,
  previewPixelsPerMeterFromScalePaperDpi,
  scaleMethodLabel,
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

  it("tolerates OCR noise and format variations with @", () => {
    expect(parseScaleAndPaper("SCALE l:200 @ A3")).toEqual({ scale: 200, paper: "A3" });
    expect(parseScaleAndPaper("Scale 1.200 @ A 3")).toEqual({ scale: 200, paper: "A3" });
    expect(parseScaleAndPaper("SCALE 1:200 @ A3J")).toEqual({ scale: 200, paper: "A3" });
    expect(parseScaleAndPaper("SCALE: 1:100 @ A1")).toEqual({ scale: 100, paper: "A1" });
    expect(parseScaleAndPaper("1:100 @ A1")).toEqual({ scale: 100, paper: "A1" });
    expect(parseScaleAndPaper("SCALE 1:10O @ A1")).toEqual({ scale: 100, paper: "A1" });
    expect(parseScaleAndPaper("SCALE 1:5O @ A1")).toEqual({ scale: 50, paper: "A1" });
  });
});

describe("parseScaleRatio", () => {
  it("parses scale ratios in 1:N format", () => {
    expect(parseScaleRatio("DRAWING SCALE 1:100")).toBe(100);
    expect(parseScaleRatio("Scale l:200")).toBe(200);
    expect(parseScaleRatio("SCALE 1:10O")).toBe(100);
    expect(parseScaleRatio("SCALE 1 : 100")).toBe(100);
    expect(parseScaleRatio("SCALE: 1/100")).toBe(100);
    expect(parseScaleRatio("1 TO 100")).toBe(100);
  });
});

describe("parsePaperFromText", () => {
  it("parses paper codes preceded by @", () => {
    expect(parsePaperFromText("@ A1")).toBe("A1");
    expect(parsePaperFromText("DRAWN @ A3")).toBe("A3");
    expect(parsePaperFromText("@A1")).toBe("A1");
    expect(parsePaperFromText("© A2")).toBe("A2");
    expect(parsePaperFromText("@ ISO A1")).toBe("A1");
  });

  it("returns null when paper code is not preceded by @", () => {
    expect(parsePaperFromText("PROJECT A1")).toBeNull();
    expect(parsePaperFromText("A2")).toBeNull();
    expect(parsePaperFromText("LEVEL A3")).toBeNull();
  });
});

describe("canonicalScaleText", () => {
  it("merges ratio and paper from close separate OCR lines", () => {
    expect(
      canonicalScaleText(null, null, [
        { text: "ABC ARCHITECTS" },
        { text: "GROUND FLOOR PLAN" },
        { text: "SCALE 1:100" },
        { text: "@ A1" },
        { text: "DATE 2026-08-28" },
        { text: "PROJECT 1024" },
      ]),
    ).toBe("1:100 @ A1");

    expect(
      canonicalScaleText(null, null, [
        { text: "1:200" },
        { text: "FLOOR PLAN" },
        { text: "@ A3" },
      ]),
    ).toBe("1:200 @ A3");
  });

  it("does not pair paper if too far from scale ratio", () => {
    expect(
      canonicalScaleText(null, null, [
        { text: "SCALE 1:100" },
        { text: "LINE 1" },
        { text: "LINE 2" },
        { text: "LINE 3" },
        { text: "@ A1" },
      ]),
    ).toBe("1:100");
  });

  it("clusters SCALE, 1:100 and @ A1 by box position even when list order is far apart", () => {
    const box = (x: number, y: number, w = 40, h = 12): [number, number][] => [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
    expect(
      canonicalScaleText(null, null, [
        { text: "SCALE", bbox: box(800, 900) },
        { text: "FIRST FLOOR PLAN", bbox: box(40, 40, 180, 16) },
        { text: "STORE", bbox: box(120, 300) },
        { text: "BED 1", bbox: box(200, 300) },
        { text: "1:100", bbox: box(850, 900) },
        { text: "ROBE", bbox: box(280, 300) },
        { text: "@ A1", bbox: box(910, 900) },
      ]),
    ).toBe("1:100 @ A1");
  });

  it("does not pair a spatially distant paper even if it is list-adjacent", () => {
    const box = (x: number, y: number, w = 40, h = 12): [number, number][] => [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
    expect(
      canonicalScaleText(null, null, [
        { text: "SCALE", bbox: box(800, 900) },
        { text: "1:100", bbox: box(850, 900) },
        { text: "@ A3", bbox: box(40, 40) },
      ]),
    ).toBe("1:100");
  });

  it("keeps full declaration when already present", () => {
    expect(canonicalScaleText("SCALE 1:200 @ A3", "A3")).toBe("1:200 @ A3");
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

describe("previewPixelsPerMeterFromScalePaperDpi", () => {
  it("matches raster calibration when DPI is unchanged", () => {
    const ppm = previewPixelsPerMeterFromScalePaperDpi({
      scaleRatio: 200,
      paper: "A3",
      dpi: 300,
      renderWidthPx: 4200,
      renderHeightPx: 2970,
      renderDpi: 300,
    });
    expect(ppm).toBeCloseTo(4200 / 84, 5);
  });

  it("scales px/m with DPI and paper", () => {
    const at300 = previewPixelsPerMeterFromScalePaperDpi({
      scaleRatio: 100,
      paper: "A4",
      dpi: 300,
    });
    const at600 = previewPixelsPerMeterFromScalePaperDpi({
      scaleRatio: 100,
      paper: "A4",
      dpi: 600,
    });
    const a3 = previewPixelsPerMeterFromScalePaperDpi({
      scaleRatio: 100,
      paper: "A3",
      dpi: 300,
    });
    expect(at300).not.toBeNull();
    expect(at600).toBeCloseTo((at300 as number) * 2, 5);
    expect(a3).not.toBeNull();
    expect(a3).toBeLessThan(at300 as number);
  });

  it("returns null without a valid 1:N", () => {
    expect(
      previewPixelsPerMeterFromScalePaperDpi({
        scaleRatio: 0,
        paper: "A4",
        dpi: 300,
      }),
    ).toBeNull();
  });
});

describe("scaleMethodLabel", () => {
  it("maps known methods to short sidebar labels", () => {
    expect(scaleMethodLabel("paper_size_auto")).toBe("Auto");
    expect(scaleMethodLabel("ocr_scale")).toBe("OCR");
    expect(scaleMethodLabel("title_block_text")).toBe("OCR");
    expect(scaleMethodLabel("auto_detect_scale")).toBe("OCR");
    expect(scaleMethodLabel("manual_scale_paper")).toBe("Manual");
    expect(scaleMethodLabel("manual_two_point")).toBe("Measure");
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
