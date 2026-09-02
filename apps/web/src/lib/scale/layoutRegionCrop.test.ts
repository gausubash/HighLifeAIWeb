import { describe, expect, it } from "vitest";
import { geometryBBox, type OverlayEntity } from "@/features/plan-editor/types";
import { pageKey, useOverlayStore } from "@/features/plan-editor/useOverlayStore";
import {
  ensureOcrLinesInPageSpace,
  findTitleBlockRegion,
  mapCropTileToPage,
  mapOcrPointsToPage,
  ocrFrameFromPixelCrop,
  ocrScaleTextForPage,
  pixelCropToNormalized,
  remapOcrLinesFromPixelCrop,
  remapOcrLinesToLayoutRegion,
  scaleNeedsCalibration,
  scaleOcrBboxes,
  shouldApplyOcrScale,
} from "./layoutRegionCrop";
import type { ScaleInfo } from "./parseScale";

describe("mapOcrPointsToPage", () => {
  it("places crop-local OCR boxes onto the drawing region in page pixels", () => {
    const pts = mapOcrPointsToPage(
      [
        [10, 20],
        [110, 20],
        [110, 40],
        [10, 40],
      ],
      { x: 0.2, y: 0.15, width: 0.7, height: 0.75 },
      2000,
      1000,
      1400,
      750,
    );
    expect(pts[0]).toEqual([410, 170]);
    expect(pts[2]).toEqual([510, 190]);
  });

  it("scales when the OCR raster DPI differs from the page", () => {
    const pts = mapOcrPointsToPage(
      [
        [0, 0],
        [2800, 0],
        [2800, 1500],
        [0, 1500],
      ],
      { x: 0.2, y: 0.15, width: 0.7, height: 0.75 },
      2000,
      1000,
      2800,
      1500,
    );
    expect(pts[0]?.[0]).toBeCloseTo(400);
    expect(pts[0]?.[1]).toBeCloseTo(150);
    expect(pts[2]?.[0]).toBeCloseTo(1800);
    expect(pts[2]?.[1]).toBeCloseTo(900);
  });
});

describe("ocrFrameFromPixelCrop", () => {
  const pixel = {
    x0: 800,
    y0: 300,
    width: 2800,
    height: 1500,
    sourceWidth: 4000,
    sourceHeight: 2000,
  };

  it("stores the PNG crop as 0–1 of the source raster", () => {
    expect(pixelCropToNormalized(pixel)).toEqual({
      x: 0.2,
      y: 0.15,
      width: 0.7,
      height: 0.75,
    });
  });

  it("places crop-local OCR on the overlay page when the PNG is a different DPI", () => {
    const frame = ocrFrameFromPixelCrop(pixel, 2000, 1000);
    const pts = mapOcrPointsToPage(
      [
        [10, 20],
        [110, 20],
        [110, 40],
        [10, 40],
      ],
      frame.layoutCrop,
      2000,
      1000,
      frame.ocrWidthPx,
      frame.ocrHeightPx,
    );
    expect(pts[0]?.[0]).toBeCloseTo(405);
    expect(pts[0]?.[1]).toBeCloseTo(160);
    expect(pts[2]?.[0]).toBeCloseTo(455);
    expect(pts[2]?.[1]).toBeCloseTo(170);
  });

  it("scales with paper DPI after OCR (crop-local boxes stay put on the ink)", () => {
    const sheet = {
      coordSpace: "crop" as const,
      ocrFrame: ocrFrameFromPixelCrop(pixel, 2000, 1000),
      lines: [
        {
          text: "UNIT 12",
          confidence: 0.9,
          bbox: [
            [10, 20],
            [110, 20],
            [110, 40],
            [10, 40],
          ],
        },
      ],
    };
    const lifted = ensureOcrLinesInPageSpace(sheet, null, 4000, 2000);
    expect(lifted?.lines?.[0]?.bbox?.[0]?.[0]).toBeCloseTo(810);
    expect(lifted?.lines?.[0]?.bbox?.[0]?.[1]).toBeCloseTo(320);
  });
});

describe("scaleOcrBboxes", () => {
  it("maps API raster boxes onto the crop PNG pixel grid", () => {
    const scaled = scaleOcrBboxes(
      { lines: [{ text: "A", confidence: 1, bbox: [[10, 20], [50, 20], [50, 36], [10, 36]] }] },
      2800,
      1500,
      1400,
      750,
    );
    expect(scaled.lines?.[0]?.bbox?.[0]?.[0]).toBeCloseTo(5);
    expect(scaled.lines?.[0]?.bbox?.[0]?.[1]).toBeCloseTo(10);
  });
});

describe("ensureOcrLinesInPageSpace", () => {
  const crop = { x: 0.2, y: 0.15, width: 0.7, height: 0.75 };
  const pageW = 2000;
  const pageH = 1000;

  it("maps crop-local boxes through the stored OCR frame", () => {
    const sheet = {
      coordSpace: "crop" as const,
      ocrFrame: {
        layoutCrop: crop,
        ocrWidthPx: 1400,
        ocrHeightPx: 750,
        pageWidthPx: 2000,
        pageHeightPx: 1000,
      },
      lines: [
        {
          text: "BED 1",
          confidence: 0.9,
          bbox: [
            [10, 20],
            [110, 20],
            [110, 40],
            [10, 40],
          ],
        },
      ],
    };
    const lifted = ensureOcrLinesInPageSpace(sheet, crop, pageW, pageH);
    expect(lifted?.lines?.[0]?.bbox?.[0]).toEqual([410, 170]);
    expect(lifted?.coordSpace).toBe("page");
  });

  it("lifts crop-local boxes into page pixels", () => {
    const sheet = {
      lines: [
        {
          text: "BED 1",
          confidence: 0.9,
          bbox: [
            [10, 20],
            [110, 20],
            [110, 40],
            [10, 40],
          ],
        },
      ],
    };
    const lifted = ensureOcrLinesInPageSpace(sheet, crop, pageW, pageH);
    expect(lifted?.lines?.[0]?.bbox?.[0]).toEqual([410, 170]);
    expect(lifted?.lines?.[0]?.bbox?.[2]).toEqual([510, 190]);
  });

  it("does not double-offset boxes that are already in page space", () => {
    const sheet = {
      lines: [
        {
          text: "BED 1",
          confidence: 0.9,
          bbox: [
            [410, 170],
            [510, 170],
            [510, 190],
            [410, 190],
          ],
        },
      ],
    };
    const kept = ensureOcrLinesInPageSpace(sheet, crop, pageW, pageH);
    expect(kept?.lines?.[0]?.bbox?.[0]).toEqual([410, 170]);
  });

  it("lifts crop-local boxes even when labels sit only on the right of the crop", () => {
    const sheet = {
      lines: [
        {
          text: "UNIT 12",
          confidence: 0.9,
          bbox: [
            [900, 20],
            [1100, 20],
            [1100, 48],
            [900, 48],
          ],
        },
      ],
    };
    const lifted = ensureOcrLinesInPageSpace(sheet, crop, pageW, pageH);
    expect(lifted?.lines?.[0]?.bbox?.[0]?.[0]).toBeCloseTo(1300);
    expect(lifted?.lines?.[0]?.bbox?.[0]?.[1]).toBeCloseTo(170);
  });
});

describe("remapOcrLinesFromPixelCrop", () => {
  it("maps crop-raster boxes through bitmap pixels onto viewer page pixels", () => {
    const sheet = {
      lines: [{ text: "U1", confidence: 1, bbox: [[10, 20], [50, 20], [50, 36], [10, 36]] }],
    };
    const remapped = remapOcrLinesFromPixelCrop(
      sheet,
      { x0: 400, y0: 300, width: 1000, height: 800, sourceWidth: 4000, sourceHeight: 2000 },
      2000,
      1000,
      1000,
      800,
    );
    expect(remapped.lines?.[0]?.bbox?.[0]?.[0]).toBeCloseTo(205);
    expect(remapped.lines?.[0]?.bbox?.[0]?.[1]).toBeCloseTo(160);
  });
});

describe("remapOcrLinesToLayoutRegion", () => {
  it("maps crop-local OCR boxes onto the layout region in viewer pixels", () => {
    const sheet = {
      lines: [
        {
          text: "BED 1",
          confidence: 0.9,
          bbox: [
            [10, 20],
            [110, 20],
            [110, 40],
            [10, 40],
          ],
        },
      ],
    };
    const remapped = remapOcrLinesToLayoutRegion(
      sheet,
      { x: 0.1, y: 0.2, width: 0.5, height: 0.4 },
      2000,
      1000,
      500,
      400,
    );
    expect(remapped.lines?.[0]?.bbox?.[0]).toEqual([220, 220]);
    expect(remapped.lines?.[0]?.bbox?.[2]).toEqual([420, 240]);
  });

  it("handles high-DPI OCR crop vs 300 DPI viewer region without full-page scale drift", () => {
    const sheet = {
      lines: [{ text: "1:200", confidence: 0.95, bbox: [[0, 0], [900, 0], [900, 90], [0, 90]] }],
    };
    const layoutCrop = { x: 0.7, y: 0.85, width: 0.28, height: 0.12 };
    const viewerW = 2480;
    const viewerH = 3508;
    const remapped = remapOcrLinesToLayoutRegion(
      sheet,
      layoutCrop,
      viewerW,
      viewerH,
      900,
      90,
    );
    const x0 = remapped.lines?.[0]?.bbox?.[0]?.[0] ?? 0;
    const y0 = remapped.lines?.[0]?.bbox?.[0]?.[1] ?? 0;
    expect(x0).toBeCloseTo(layoutCrop.x * viewerW, 0);
    expect(y0).toBeCloseTo(layoutCrop.y * viewerH, 0);
  });
});

describe("mapCropTileToPage", () => {
  it("maps crop-local tile pixels onto the layout region in viewer pixels", () => {
    const crop = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };
    const mapped = mapCropTileToPage(crop, { x: 10, y: 20, width: 100, height: 20 }, 2000, 1000, 500, 400);
    expect(mapped.x).toBeCloseTo(220);
    expect(mapped.y).toBeCloseTo(220);
    expect(mapped.width).toBeCloseTo(200);
    expect(mapped.height).toBeCloseTo(20);
  });
});

describe("findTitleBlockRegion", () => {
  it("prefers the small title_block box over a large mis-tagged region", () => {
    const analysisId = "a1";
    const pageNumber = 1;
    const key = pageKey(analysisId, pageNumber);
    const now = new Date().toISOString();
    const big: OverlayEntity = {
      id: "big",
      type: "title_block",
      layer: "layout",
      geometry: {
        kind: "polygon",
        points: [
          { x: 0, y: 0 },
          { x: 2000, y: 0 },
          { x: 2000, y: 1400 },
          { x: 0, y: 1400 },
        ],
      },
      label: "Title block",
      confidence: 0.99,
      status: "predicted",
      source: "model",
      attributes: {},
      createdAt: now,
      updatedAt: now,
    };
    const small: OverlayEntity = {
      id: "small",
      type: "title_block",
      layer: "layout",
      geometry: {
        kind: "polygon",
        points: [
          { x: 1500, y: 1200 },
          { x: 1980, y: 1200 },
          { x: 1980, y: 1450 },
          { x: 1500, y: 1450 },
        ],
      },
      label: "Title block",
      confidence: 0.88,
      status: "predicted",
      source: "model",
      attributes: {},
      createdAt: now,
      updatedAt: now,
    };
    useOverlayStore.setState({
      pages: {
        [key]: {
          analysisId,
          pageNumber,
          entities: [big, small],
          selectedIds: [],
        },
      },
    });
    const info = findTitleBlockRegion(analysisId, pageNumber, 2000, 1500);
    expect(info).not.toBeNull();
    expect(info?.widthPx).toBe(geometryBBox(small.geometry).width);
    expect(info?.areaFrac).toBeLessThan(0.1);
  });

  it("prefers a bottom-right title block over an equally small top-left box", () => {
    const analysisId = "a1";
    const pageNumber = 1;
    const key = pageKey(analysisId, pageNumber);
    const now = new Date().toISOString();
    const topLeft: OverlayEntity = {
      id: "tl",
      type: "title_block",
      layer: "layout",
      geometry: {
        kind: "polygon",
        points: [
          { x: 20, y: 20 },
          { x: 420, y: 20 },
          { x: 420, y: 220 },
          { x: 20, y: 220 },
        ],
      },
      label: "Title block",
      confidence: 0.95,
      status: "predicted",
      source: "model",
      attributes: {},
      createdAt: now,
      updatedAt: now,
    };
    const bottomRight: OverlayEntity = {
      id: "br",
      type: "title_block",
      layer: "layout",
      geometry: {
        kind: "polygon",
        points: [
          { x: 1580, y: 1280 },
          { x: 1980, y: 1280 },
          { x: 1980, y: 1480 },
          { x: 1580, y: 1480 },
        ],
      },
      label: "Title block",
      confidence: 0.88,
      status: "predicted",
      source: "model",
      attributes: {},
      createdAt: now,
      updatedAt: now,
    };
    useOverlayStore.setState({
      pages: {
        [key]: {
          analysisId,
          pageNumber,
          entities: [topLeft, bottomRight],
          selectedIds: [],
        },
      },
    });
    const info = findTitleBlockRegion(analysisId, pageNumber, 2000, 1500);
    expect(info).not.toBeNull();
    expect(info?.widthPx).toBe(geometryBBox(bottomRight.geometry).width);
  });
});

describe("scale OCR helpers", () => {
  const baseScale: ScaleInfo = {
    scaleRatio: null,
    paper: null,
    paperFromPdf: "A3",
    pageWidthPt: 842,
    pageHeightPt: 1191,
    pageWidthMm: 297,
    pageHeightMm: 420,
    method: "paper_size_auto",
    confidence: 0.6,
    pixelsPerMeter: null,
    scaleLabel: null,
  };

  it("scaleNeedsCalibration is true without px/m", () => {
    expect(scaleNeedsCalibration(baseScale)).toBe(true);
    expect(scaleNeedsCalibration({ ...baseScale, pixelsPerMeter: 120 })).toBe(false);
  });

  it("shouldApplyOcrScale replaces PDF placeholder scales", () => {
    expect(
      shouldApplyOcrScale({
        ...baseScale,
        pixelsPerMeter: 80,
        method: "paper_size_auto",
      }),
    ).toBe(true);
    expect(
      shouldApplyOcrScale({
        ...baseScale,
        pixelsPerMeter: 80,
        method: "manual_scale_paper",
      }),
    ).toBe(false);
  });

  it("ocrScaleTextForPage prefers canonical scale from lines", () => {
    const text = ocrScaleTextForPage({
      ocrMeta: {
        scaleText: "1:200",
        paperSize: "A1",
        lines: [{ text: "SCALE 1:200 @ A3", confidence: 0.9, bbox: [] }],
      },
    });
    expect(text).toMatch(/1:200/);
    expect(text).toMatch(/A3/);
  });
});
