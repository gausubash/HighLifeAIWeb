import { describe, expect, it } from "vitest";
import { geometryBBox, type OverlayEntity } from "@/features/plan-editor/types";
import { pageKey, useOverlayStore } from "@/features/plan-editor/useOverlayStore";
import {
  findTitleBlockRegion,
  mapCropTileToPage,
  ocrScaleTextForPage,
  remapOcrLinesToLayoutRegion,
  scaleNeedsCalibration,
  shouldApplyOcrScale,
} from "./layoutRegionCrop";
import type { ScaleInfo } from "./parseScale";

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
