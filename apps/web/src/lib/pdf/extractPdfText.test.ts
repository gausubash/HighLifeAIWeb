import { describe, expect, it } from "vitest";
import {
  bboxCenter,
  emptyPdfTextMessage,
  mapViewportQuadToPage,
  pdfTextItemToViewportQuad,
  pdfTextItemsToLines,
  pointInNormalizedCrop,
  splitPdfTextByLayoutCrops,
} from "./extractPdfText";

describe("pdfTextItemToViewportQuad", () => {
  it("maps horizontal PDF text (origin bottom-left) onto a Y-flipped viewport", () => {
    const viewportTransform: [number, number, number, number, number, number] = [1, 0, 0, -1, 0, 100];
    const quad = pdfTextItemToViewportQuad(
      { transform: [12, 0, 0, 12, 10, 20], width: 36, height: 12 },
      viewportTransform,
    );
    expect(quad).not.toBeNull();
    expect(quad![0][0]).toBeCloseTo(10);
    expect(quad![0][1]).toBeCloseTo(68);
    expect(quad![1][0]).toBeCloseTo(46);
    expect(quad![2][1]).toBeCloseTo(80);
  });

  it("still maps CAD-style items with a degenerate font matrix", () => {
    const viewportTransform: [number, number, number, number, number, number] = [1, 0, 0, -1, 0, 100];
    const quad = pdfTextItemToViewportQuad(
      { transform: [0, 0, 0, 0, 40, 30], width: 24, height: 0 },
      viewportTransform,
    );
    expect(quad).not.toBeNull();
    expect(quad![0][0]).toBeCloseTo(40);
  });

  it("accepts a typed-array transform from pdf.js", () => {
    const viewportTransform: [number, number, number, number, number, number] = [1, 0, 0, -1, 0, 100];
    const transform = new Float64Array([12, 0, 0, 12, 10, 20]);
    const quad = pdfTextItemToViewportQuad({ transform, width: 36, height: 12 }, viewportTransform);
    expect(quad).not.toBeNull();
    expect(quad![0][0]).toBeCloseTo(10);
  });

  it("scales viewport quads onto the page raster", () => {
    const page = mapViewportQuadToPage(
      [
        [10, 68],
        [46, 68],
        [46, 80],
        [10, 80],
      ],
      100,
      100,
      200,
      200,
    );
    expect(page[0]).toEqual([20, 136]);
    expect(page[2]).toEqual([92, 160]);
  });
});

describe("splitPdfTextByLayoutCrops", () => {
  it("puts title-block text in title and the rest in drawing", () => {
    const titleCrop = { x: 0.7, y: 0.8, width: 0.3, height: 0.2 };
    const lines = [
      {
        text: "1:100",
        confidence: 1,
        bbox: [
          [160, 90],
          [190, 90],
          [190, 98],
          [160, 98],
        ] as [number, number][],
      },
      {
        text: "BALCONY",
        confidence: 1,
        bbox: [
          [20, 20],
          [60, 20],
          [60, 28],
          [20, 28],
        ] as [number, number][],
      },
    ];
    const split = splitPdfTextByLayoutCrops(lines, titleCrop, 200, 100);
    expect(split.title.map((l) => l.text)).toEqual(["1:100"]);
    expect(split.drawing.map((l) => l.text)).toEqual(["BALCONY"]);
  });

  it("keeps every line in drawing when there is no title box", () => {
    const lines = [{ text: "A", confidence: 1, bbox: [[1, 1], [2, 1], [2, 2], [1, 2]] as [number, number][] }];
    const split = splitPdfTextByLayoutCrops(lines, null, 100, 100);
    expect(split.title).toEqual([]);
    expect(split.drawing).toHaveLength(1);
  });

  it("clips drawing lines to the main drawing zone when a crop is set", () => {
    const drawingCrop = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
    const lines = [
      {
        text: "BALCONY",
        confidence: 1,
        bbox: [
          [30, 30],
          [60, 30],
          [60, 38],
          [30, 38],
        ] as [number, number][],
      },
      {
        text: "1:100",
        confidence: 1,
        bbox: [
          [160, 90],
          [190, 90],
          [190, 98],
          [160, 98],
        ] as [number, number][],
      },
    ];
    const split = splitPdfTextByLayoutCrops(lines, null, 200, 100, drawingCrop);
    expect(split.drawing.map((l) => l.text)).toEqual(["BALCONY"]);
  });
});

describe("pointInNormalizedCrop", () => {
  it("uses the layout box in page pixels", () => {
    const crop = { x: 0.2, y: 0.15, width: 0.7, height: 0.75 };
    expect(pointInNormalizedCrop(410, 170, crop, 2000, 1000)).toBe(true);
    expect(pointInNormalizedCrop(10, 10, crop, 2000, 1000)).toBe(false);
    expect(bboxCenter([[0, 0], [10, 0], [10, 10], [0, 10]])).toEqual({ x: 5, y: 5 });
  });
});

describe("emptyPdfTextMessage", () => {
  it("explains outlined CAD labels when there are paths but no text ops", () => {
    expect(
      emptyPdfTextMessage({
        itemCount: 0,
        textItemCount: 0,
        mappedCount: 0,
        textOps: 0,
        vectorOps: 400,
      }),
    ).toMatch(/outlines labels as paths/i);
  });

  it("explains missing Unicode maps when showText ops exist", () => {
    expect(
      emptyPdfTextMessage({
        itemCount: 0,
        textItemCount: 0,
        mappedCount: 0,
        textOps: 12,
        vectorOps: 400,
      }),
    ).toMatch(/no Unicode map/i);
  });
});

describe("pdfTextItemsToLines", () => {
  it("keeps a string even when the item has no transform", () => {
    const lines = pdfTextItemsToLines(
      [{ str: "BALCONY", width: 40, height: 8 }],
      { width: 100, height: 100, transform: [1, 0, 0, -1, 0, 100] },
      200,
      200,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe("BALCONY");
    expect(lines[0]!.bbox).toHaveLength(4);
  });
});
