"use client";

/**
 * PDF → PNG rendering via pdf.js.
 * Target print-quality raster: 300 DPI (PDF user space is 72 pt/inch).
 */

import {
  classifyPdfGraphics,
  countPdfOperators,
  type PdfGraphicsInfo,
} from "./classifyPdfGraphics";
import { normalizeRotation, type PageRotationDeg } from "./pageRotation";
import { PDFJS_WORKER_SRC, pdfjsGetDocumentParams } from "./pdfjsDocument";

export const PDF_RENDER_DPI = 300;
/** pdf.js viewport scale for 300 DPI: dpi / 72 */
export const PDF_RENDER_SCALE = PDF_RENDER_DPI / 72;

export const PDF_UPLOAD_DPI_MIN = 150;
export const PDF_UPLOAD_DPI_MAX = 1200;

export function clampPdfUploadDpi(dpi: number): number {
  if (!Number.isFinite(dpi)) return PDF_RENDER_DPI;
  return Math.min(PDF_UPLOAD_DPI_MAX, Math.max(PDF_UPLOAD_DPI_MIN, Math.round(dpi)));
}

export function pdfRenderScale(dpi: number): number {
  return clampPdfUploadDpi(dpi) / 72;
}

/** Estimate the raster DPI used when the PDF page was converted to a PNG. */
export function inferRenderDpi(
  widthPx: number,
  heightPx: number,
  pageWidthPt: number,
  pageHeightPt: number,
): number {
  const sx = pageWidthPt > 0 ? widthPx / pageWidthPt : 0;
  const sy = pageHeightPt > 0 ? heightPx / pageHeightPt : 0;
  const scalePt = sx > 0 && sy > 0 ? (sx + sy) / 2 : sx || sy;
  if (!(scalePt > 0)) return PDF_RENDER_DPI;
  return clampPdfUploadDpi(scalePt * 72);
}

export type RenderedPdfPage = {
  pageNumber: number;
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  pageWidthPt: number;
  pageHeightPt: number;
  textContent: string;
  dpi: number;
  graphics: PdfGraphicsInfo;
};

let workerConfigured = false;

type PdfjsLibLike = {
  OPS?: Record<string, number>;
  GlobalWorkerOptions: {
    workerSrc: string;
  };
  getDocument: (args: unknown) => { promise: Promise<PdfDocLike> };
};

type PdfDocLike = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PageLike>;
};

type ViewportLike = {
  width: number;
  height: number;
};

type TextItemLike = {
  str?: string;
};

type TextContentLike = {
  items: TextItemLike[];
};

type PageLike = {
  rotate?: number;
  getViewport: (args: { scale: number; rotation?: number }) => ViewportLike;
  render: (args: {
    canvasContext: CanvasRenderingContext2D;
    viewport: ViewportLike;
  }) => { promise: Promise<void> };
  getTextContent: () => Promise<TextContentLike>;
  getOperatorList?: () => Promise<{ fnArray: number[] }>;
};

async function ensurePdfJsWorkerConfigured(pdfjsLib: PdfjsLibLike): Promise<void> {
  if (workerConfigured) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_SRC;
  workerConfigured = true;
}

async function loadPdf(file: File): Promise<{ doc: PdfDocLike; ops: Record<string, number> }> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfjsLib = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLibLike;
  await ensurePdfJsWorkerConfigured(pdfjsLib);
  const doc = await pdfjsLib.getDocument(pdfjsGetDocumentParams(arrayBuffer)).promise;
  return { doc, ops: pdfjsLib.OPS ?? {} };
}

async function inspectPageGraphics(
  page: PageLike,
  ops: Record<string, number>,
): Promise<PdfGraphicsInfo> {
  if (!page.getOperatorList || Object.keys(ops).length === 0) {
    return classifyPdfGraphics({ vectorOps: 0, imageOps: 0, textOps: 0 });
  }
  try {
    const list = await page.getOperatorList();
    return classifyPdfGraphics(countPdfOperators(list.fnArray ?? [], ops));
  } catch {
    return classifyPdfGraphics({ vectorOps: 0, imageOps: 0, textOps: 0 });
  }
}

async function renderSinglePage(
  page: PageLike,
  pageNumber: number,
  scale: number,
  dpi: number,
  ops: Record<string, number>,
  extraRotation: PageRotationDeg = 0,
): Promise<RenderedPdfPage> {
  const pageRotate = typeof page.rotate === "number" ? page.rotate : 0;
  const rotation = normalizeRotation(pageRotate + extraRotation);
  const baseViewport = page.getViewport({ scale: 1, rotation });
  const textContent = await page.getTextContent();
  const textStr = textContent.items.map((item) => item.str ?? "").join(" ");
  const graphics = await inspectPageGraphics(page, ops);

  const viewport = page.getViewport({ scale, rotation });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Unable to create 2D canvas context.");

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  await page.render({
    canvasContext: context,
    viewport,
  }).promise;

  return {
    pageNumber,
    dataUrl: canvas.toDataURL("image/png"),
    widthPx: canvas.width,
    heightPx: canvas.height,
    pageWidthPt: baseViewport.width,
    pageHeightPt: baseViewport.height,
    textContent: textStr,
    dpi,
    graphics,
  };
}

/**
 * Converts every PDF page to a PNG raster at the given DPI (default 300).
 */
export async function renderAllPdfPagesToPng(
  file: File,
  opts?: {
    dpi?: number;
    rotation?: PageRotationDeg;
    rotationForPage?: (pageNumber: number) => PageRotationDeg;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<RenderedPdfPage[]> {
  const dpi = opts?.dpi ?? PDF_RENDER_DPI;
  const scale = dpi / 72;
  const { doc, ops } = await loadPdf(file);
  const total = doc.numPages;
  const pages: RenderedPdfPage[] = [];

  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const rotation = opts?.rotationForPage?.(i) ?? opts?.rotation ?? 0;
    pages.push(await renderSinglePage(page, i, scale, dpi, ops, rotation));
    opts?.onProgress?.(i, total);
  }

  return pages;
}

/** Renders only page 1 (legacy helper). */
export async function renderPdfFirstPageToPngDataUrl(
  file: File,
  opts?: { dpi?: number; rotation?: PageRotationDeg },
): Promise<RenderedPdfPage> {
  const dpi = opts?.dpi ?? PDF_RENDER_DPI;
  const { doc, ops } = await loadPdf(file);
  const page = await doc.getPage(1);
  return renderSinglePage(page, 1, dpi / 72, dpi, ops, opts?.rotation ?? 0);
}
