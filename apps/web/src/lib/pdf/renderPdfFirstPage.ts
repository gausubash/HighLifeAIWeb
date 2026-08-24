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

export const PDF_RENDER_DPI = 300;
/** pdf.js viewport scale for 300 DPI: dpi / 72 */
export const PDF_RENDER_SCALE = PDF_RENDER_DPI / 72;

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
  getViewport: (args: { scale: number }) => ViewportLike;
  render: (args: {
    canvasContext: CanvasRenderingContext2D;
    viewport: ViewportLike;
  }) => { promise: Promise<void> };
  getTextContent: () => Promise<TextContentLike>;
  getOperatorList?: () => Promise<{ fnArray: number[] }>;
};

async function ensurePdfJsWorkerConfigured(pdfjsLib: PdfjsLibLike): Promise<void> {
  if (workerConfigured) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://unpkg.com/pdfjs-dist@6.2.108/legacy/build/pdf.worker.min.mjs";
  workerConfigured = true;
}

async function loadPdf(file: File): Promise<{ doc: PdfDocLike; ops: Record<string, number> }> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfjsLib = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLibLike;
  await ensurePdfJsWorkerConfigured(pdfjsLib);
  const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
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
): Promise<RenderedPdfPage> {
  const baseViewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();
  const textStr = textContent.items.map((item) => item.str ?? "").join(" ");
  const graphics = await inspectPageGraphics(page, ops);

  const viewport = page.getViewport({ scale });
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
    pages.push(await renderSinglePage(page, i, scale, dpi, ops));
    opts?.onProgress?.(i, total);
  }

  return pages;
}

/** Renders only page 1 (legacy helper). */
export async function renderPdfFirstPageToPngDataUrl(
  file: File,
  opts?: { dpi?: number },
): Promise<RenderedPdfPage> {
  const dpi = opts?.dpi ?? PDF_RENDER_DPI;
  const { doc, ops } = await loadPdf(file);
  const page = await doc.getPage(1);
  return renderSinglePage(page, 1, dpi / 72, dpi, ops);
}
