"use client";

import type { OcrLine } from "@highlife/shared-types";
import type { NormalizedCrop } from "@/lib/scale/layoutRegionCrop";
import { countPdfOperators } from "./classifyPdfGraphics";
import { mapPdfViewportToPage } from "./pdfPageMap";
import { inferViewerRotation, normalizeRotation, type PageRotationDeg } from "./pageRotation";
import { loadOriginalPdfBytes } from "./sourcePdfStore";
import { PDFJS_WORKER_SRC, pdfjsGetDocumentParams } from "./pdfjsDocument";

type Matrix = [number, number, number, number, number, number];

type PdfjsLibLike = {
  OPS?: Record<string, number>;
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (args: unknown) => { promise: Promise<PdfDocLike> };
};

type PdfDocLike = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PageLike>;
  destroy?: () => Promise<void>;
};

type ViewportLike = {
  width: number;
  height: number;
  transform: Matrix;
};

type TextItemLike = {
  str?: string;
  transform?: ArrayLike<number>;
  width?: number;
  height?: number;
  hasEOL?: boolean;
};

type PageLike = {
  rotate?: number;
  getViewport: (args: { scale: number; rotation?: number }) => ViewportLike;
  getTextContent: (params?: {
    includeMarkedContent?: boolean;
    disableNormalization?: boolean;
  }) => Promise<{ items: TextItemLike[] }>;
  getOperatorList?: () => Promise<{ fnArray: number[] }>;
};

let workerConfigured = false;

async function loadPdfJs(): Promise<PdfjsLibLike> {
  const pdfjsLib = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLibLike;
  if (!workerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
    workerConfigured = true;
  }
  return pdfjsLib;
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function asMatrix(raw: ArrayLike<number> | undefined): Matrix | null {
  if (!raw || raw.length < 6) return null;
  const nums: Matrix = [
    Number(raw[0]),
    Number(raw[1]),
    Number(raw[2]),
    Number(raw[3]),
    Number(raw[4]),
    Number(raw[5]),
  ];
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return nums;
}

function axisAlignedQuad(left: number, top: number, width: number, height: number): [number, number][] {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  return [
    [left, top],
    [left + w, top],
    [left + w, top + h],
    [left, top + h],
  ];
}

/** Quad in pdf.js viewport pixels (origin top-left), matching the text layer. */
export function pdfTextItemToViewportQuad(
  item: { transform: ArrayLike<number>; width: number; height: number },
  viewportTransform: Matrix,
): [number, number][] | null {
  const itemT = asMatrix(item.transform);
  if (!itemT) return null;
  const tm = multiply(viewportTransform, itemT);
  const angle = Math.atan2(tm[1], tm[0]);
  const fontHeight =
    Math.hypot(tm[2], tm[3]) || Math.hypot(tm[0], tm[1]) || Math.abs(item.height) || 1;
  const width =
    item.height > 1e-6 ? (item.width * fontHeight) / item.height : Math.max(item.width, fontHeight * 0.5, 1);
  const fontAscent = fontHeight;
  let left = tm[4];
  let top = tm[5] - fontAscent;
  if (Math.abs(angle) > 1e-6) {
    left = tm[4] - fontAscent * Math.sin(angle);
    top = tm[5] - fontAscent * Math.cos(angle);
  }
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const w = Math.max(1, width);
  const h = fontHeight;
  return [
    [left, top],
    [left + w * c, top + w * s],
    [left + w * c - h * s, top + w * s + h * c],
    [left - h * s, top + h * c],
  ];
}

function fallbackViewportQuad(
  item: { transform?: ArrayLike<number>; width?: number; height?: number },
  viewportTransform: Matrix,
): [number, number][] {
  const w = Math.max(Number(item.width) || 8, 8);
  const h = Math.max(Number(item.height) || 8, 8);
  const itemT = asMatrix(item.transform);
  if (!itemT) return axisAlignedQuad(0, 0, w, h);
  const tm = multiply(viewportTransform, itemT);
  return axisAlignedQuad(tm[4], tm[5] - h, w, h);
}

export function mapViewportQuadToPage(
  quad: [number, number][],
  viewportWidth: number,
  viewportHeight: number,
  pageWidthPx: number,
  pageHeightPx: number,
): [number, number][] {
  return quad.map(([x, y]) => {
    const p = mapPdfViewportToPage(x, y, viewportWidth, viewportHeight, pageWidthPx, pageHeightPx);
    return [p.x, p.y];
  });
}

export function bboxCenter(bbox: [number, number][]): { x: number; y: number } | null {
  if (!bbox.length) return null;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of bbox) {
    sx += x;
    sy += y;
  }
  return { x: sx / bbox.length, y: sy / bbox.length };
}

export function pointInNormalizedCrop(
  x: number,
  y: number,
  crop: NormalizedCrop,
  pageWidthPx: number,
  pageHeightPx: number,
): boolean {
  const x0 = crop.x * pageWidthPx;
  const y0 = crop.y * pageHeightPx;
  const x1 = x0 + crop.width * pageWidthPx;
  const y1 = y0 + crop.height * pageHeightPx;
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

export function splitPdfTextByLayoutCrops(
  lines: OcrLine[],
  titleCrop: NormalizedCrop | null | undefined,
  pageWidthPx: number,
  pageHeightPx: number,
  drawingCrop?: NormalizedCrop | null,
): { title: OcrLine[]; drawing: OcrLine[] } {
  const title: OcrLine[] = [];
  const drawing: OcrLine[] = [];

  const inCrop = (line: OcrLine, crop: NormalizedCrop | null | undefined): boolean => {
    if (!crop) return false;
    const c = line.bbox ? bboxCenter(line.bbox) : null;
    return c ? pointInNormalizedCrop(c.x, c.y, crop, pageWidthPx, pageHeightPx) : false;
  };

  for (const line of lines) {
    const inTitle = inCrop(line, titleCrop);
    const inDrawing = drawingCrop ? inCrop(line, drawingCrop) : !titleCrop || !inTitle;

    if (inTitle) title.push(line);
    if (inDrawing) drawing.push(line);
  }

  return { title, drawing };
}

/** Full-page PDF text split only by title block; remainder stays in drawing. */
export function splitPdfTextFullPage(
  lines: OcrLine[],
  titleCrop: NormalizedCrop | null | undefined,
  pageWidthPx: number,
  pageHeightPx: number,
): { title: OcrLine[]; drawing: OcrLine[] } {
  return splitPdfTextByLayoutCrops(lines, titleCrop, pageWidthPx, pageHeightPx, null);
}

/** Drawing-area PDF text — only lines whose centroid falls inside the main drawing zone. */
export function filterPdfTextToDrawingArea(
  lines: OcrLine[],
  drawingCrop: NormalizedCrop | null | undefined,
  pageWidthPx: number,
  pageHeightPx: number,
): OcrLine[] {
  if (!drawingCrop) return [];
  return splitPdfTextByLayoutCrops(lines, null, pageWidthPx, pageHeightPx, drawingCrop).drawing;
}

export type PdfTextExtractStats = {
  itemCount: number;
  textItemCount: number;
  mappedCount: number;
  textOps: number;
  vectorOps: number;
};

export function emptyPdfTextMessage(stats: PdfTextExtractStats): string {
  if (stats.textItemCount > 0 && stats.mappedCount === 0) {
    return "PDF text was found but boxes could not be mapped. Try Run OCR.";
  }
  if (stats.textOps > 0) {
    return "This PDF paints glyphs with fonts that have no Unicode map (common in CAD). Use Run OCR.";
  }
  if (stats.vectorOps > 0) {
    return "Vector linework is not a text layer — CAD often outlines labels as paths. Use Run OCR.";
  }
  return "No selectable text in this PDF. Use Run OCR for scans.";
}

export function pdfTextItemsToLines(
  items: TextItemLike[],
  viewport: { width: number; height: number; transform: Matrix },
  pageWidthPx: number,
  pageHeightPx: number,
): OcrLine[] {
  const lines: OcrLine[] = [];
  for (const item of items) {
    const text = String(item.str ?? "").trim();
    if (!text) continue;
    const transform = item.transform;
    const mapped =
      transform && transform.length >= 6
        ? pdfTextItemToViewportQuad(
            {
              transform,
              width: Number(item.width) || 0,
              height: Number(item.height) || 0,
            },
            viewport.transform,
          )
        : null;
    const quad = mapped ?? fallbackViewportQuad(item, viewport.transform);
    lines.push({
      text,
      confidence: 1,
      bbox: mapViewportQuadToPage(
        quad,
        viewport.width,
        viewport.height,
        pageWidthPx,
        pageHeightPx,
      ),
    });
  }
  return lines;
}

export type ExtractedPdfPageText = {
  pageNumber: number;
  lines: OcrLine[];
  textHint: string;
  stats: PdfTextExtractStats;
  emptyReason: string | null;
};

export async function extractPdfPageText(args: {
  analysisId: string;
  storagePath: string;
  sourceFileName: string;
  pageImagePath?: string;
  pageNumber: number;
  pageWidthPx: number;
  pageHeightPx: number;
  rotationDeg?: PageRotationDeg;
  signal?: AbortSignal;
}): Promise<ExtractedPdfPageText> {
  const data = await loadOriginalPdfBytes({
    analysisId: args.analysisId,
    storagePath: args.storagePath,
    sourceFileName: args.sourceFileName,
    pageImagePath: args.pageImagePath,
    signal: args.signal,
  });
  if (args.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const pdfjsLib = await loadPdfJs();
  const doc = await pdfjsLib.getDocument(pdfjsGetDocumentParams(data)).promise;
  try {
    const pageNo = Math.min(Math.max(1, Math.round(args.pageNumber) || 1), Math.max(1, doc.numPages));
    const page = await doc.getPage(pageNo);
    const pageRotate = typeof page.rotate === "number" ? page.rotate : 0;
    const native = page.getViewport({ scale: 1, rotation: pageRotate });
    const viewerRotation = inferViewerRotation({
      stored: args.rotationDeg,
      pdfWidth: native.width,
      pdfHeight: native.height,
      pageWidthPx: args.pageWidthPx,
      pageHeightPx: args.pageHeightPx,
    });
    const viewport = page.getViewport({
      scale: 1,
      rotation: normalizeRotation(pageRotate + viewerRotation),
    });
    const content = await page.getTextContent({
      includeMarkedContent: false,
      disableNormalization: false,
    });
    const items = content.items ?? [];
    const lines = pdfTextItemsToLines(items, viewport, args.pageWidthPx, args.pageHeightPx);
    let textOps = 0;
    let vectorOps = 0;
    if (page.getOperatorList && pdfjsLib.OPS) {
      try {
        const list = await page.getOperatorList();
        const counts = countPdfOperators(list.fnArray ?? [], pdfjsLib.OPS);
        textOps = counts.textOps;
        vectorOps = counts.vectorOps;
      } catch {
        /* operator list is diagnostic only */
      }
    }
    const stats: PdfTextExtractStats = {
      itemCount: items.length,
      textItemCount: items.filter((item) => String(item.str ?? "").trim()).length,
      mappedCount: lines.length,
      textOps,
      vectorOps,
    };
    return {
      pageNumber: pageNo,
      lines,
      textHint: lines.map((l) => l.text).join("\n"),
      stats,
      emptyReason: lines.length > 0 ? null : emptyPdfTextMessage(stats),
    };
  } finally {
    try {
      await doc.destroy?.();
    } catch {
      /* ignore */
    }
  }
}
