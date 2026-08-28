import type { PlanEntityType } from "@highlife/shared-types";
import { geometryBBox } from "@/features/plan-editor/types";
import { pageKey, useOverlayStore } from "@/features/plan-editor/useOverlayStore";
import type { SheetOcrMeta } from "@/lib/api/ocrClient";
import {
  A_PAPER_SIZES_MM,
  canonicalScaleText,
  parsePaperFromText,
  parseScaleAndPaper,
  parseScaleRatio,
  type ScaleInfo,
} from "@/lib/scale/parseScale";

export type NormalizedCrop = { x: number; y: number; width: number; height: number };

export type LayoutRegionInfo = {
  crop: NormalizedCrop;
  label: string;
  confidence: number;
  widthPx: number;
  heightPx: number;
  /** Fraction of page area (0–1). */
  areaFrac: number;
};

const PAD_FRAC = 0.02;
/** Title blocks are a small sheet corner — reject layout boxes larger than this. */
const MAX_TITLE_BLOCK_AREA_FRAC = 0.25;

function titleBlockCornerScore(
  bbox: { x: number; y: number; width: number; height: number },
  pageWidthPx: number,
  pageHeightPx: number,
  areaFrac: number,
  confidence: number,
): number {
  const cx = (bbox.x + bbox.width / 2) / pageWidthPx;
  const cy = (bbox.y + bbox.height / 2) / pageHeightPx;
  const corner = cx * 0.55 + cy * 0.45;
  const smallness = 1 - Math.min(1, areaFrac / MAX_TITLE_BLOCK_AREA_FRAC);
  return corner * 0.5 + smallness * 0.35 + confidence * 0.15;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export function padNormalizedCrop(crop: NormalizedCrop, pad = PAD_FRAC): NormalizedCrop {
  const x = clamp01(crop.x - crop.width * pad);
  const y = clamp01(crop.y - crop.height * pad);
  const right = clamp01(crop.x + crop.width + crop.width * pad);
  const bottom = clamp01(crop.y + crop.height + crop.height * pad);
  return { x, y, width: Math.max(0.01, right - x), height: Math.max(0.01, bottom - y) };
}

/** Layout region bbox from detection, normalized to page pixel dimensions. */
export function findLayoutRegion(
  analysisId: string,
  pageNumber: number,
  pageWidthPx: number,
  pageHeightPx: number,
  entityType: PlanEntityType,
  options?: { maxAreaFrac?: number; preferSmallest?: boolean },
): LayoutRegionInfo | null {
  if (pageWidthPx < 1 || pageHeightPx < 1) return null;
  const key = pageKey(analysisId, pageNumber);
  const entities = useOverlayStore.getState().pages[key]?.entities ?? [];
  const pageArea = pageWidthPx * pageHeightPx;
  const maxAreaFrac = options?.maxAreaFrac ?? 1;
  const candidates = entities
    .filter((e) => e.type === entityType && e.status !== "rejected")
    .map((e) => {
      const bbox = geometryBBox(e.geometry);
      const areaFrac = (bbox.width * bbox.height) / pageArea;
      return { entity: e, bbox, areaFrac };
    })
    .filter((c) => c.bbox.width >= 8 && c.bbox.height >= 8 && c.areaFrac <= maxAreaFrac);

  const pool =
    candidates.length > 0
      ? candidates
      : entities
          .filter((e) => e.type === entityType && e.status !== "rejected")
          .map((e) => {
            const bbox = geometryBBox(e.geometry);
            const areaFrac = (bbox.width * bbox.height) / pageArea;
            return { entity: e, bbox, areaFrac };
          })
          .filter((c) => c.bbox.width >= 8 && c.bbox.height >= 8);

  if (!pool.length) return null;

  const manualScore = (entity: (typeof pool)[number]["entity"]) =>
    entity.source === "manual" ? 2 : entity.status === "user_edited" ? 1 : 0;

  pool.sort((a, b) => {
    const manualA = manualScore(a.entity);
    const manualB = manualScore(b.entity);
    if (manualA !== manualB) return manualB - manualA;
    if (options?.preferSmallest) {
      const scoreA = titleBlockCornerScore(a.bbox, pageWidthPx, pageHeightPx, a.areaFrac, a.entity.confidence);
      const scoreB = titleBlockCornerScore(b.bbox, pageWidthPx, pageHeightPx, b.areaFrac, b.entity.confidence);
      if (Math.abs(scoreA - scoreB) > 0.02) return scoreB - scoreA;
      if (Math.abs(a.areaFrac - b.areaFrac) > 0.005) return a.areaFrac - b.areaFrac;
    }
    return b.entity.confidence - a.entity.confidence;
  });

  const best = pool[0];
  const crop = padNormalizedCrop({
    x: best.bbox.x / pageWidthPx,
    y: best.bbox.y / pageHeightPx,
    width: best.bbox.width / pageWidthPx,
    height: best.bbox.height / pageHeightPx,
  });
  if (crop.width <= 0 || crop.height <= 0) return null;

  return {
    crop,
    label: best.entity.label,
    confidence: best.entity.confidence,
    widthPx: Math.round(best.bbox.width),
    heightPx: Math.round(best.bbox.height),
    areaFrac: best.areaFrac,
  };
}

export function findLayoutRegionCrop(
  analysisId: string,
  pageNumber: number,
  pageWidthPx: number,
  pageHeightPx: number,
  entityType: PlanEntityType,
  options?: { maxAreaFrac?: number; preferSmallest?: boolean },
): NormalizedCrop | null {
  return findLayoutRegion(analysisId, pageNumber, pageWidthPx, pageHeightPx, entityType, options)?.crop ?? null;
}

export function findTitleBlockRegion(
  analysisId: string,
  pageNumber: number,
  pageWidthPx: number,
  pageHeightPx: number,
): LayoutRegionInfo | null {
  return findLayoutRegion(analysisId, pageNumber, pageWidthPx, pageHeightPx, "title_block", {
    maxAreaFrac: MAX_TITLE_BLOCK_AREA_FRAC,
    preferSmallest: true,
  });
}

export function findTitleBlockCrop(
  analysisId: string,
  pageNumber: number,
  pageWidthPx: number,
  pageHeightPx: number,
): NormalizedCrop | null {
  return findTitleBlockRegion(analysisId, pageNumber, pageWidthPx, pageHeightPx)?.crop ?? null;
}

export function findDrawingAreaRegion(
  analysisId: string,
  pageNumber: number,
  pageWidthPx: number,
  pageHeightPx: number,
): LayoutRegionInfo | null {
  return findLayoutRegion(analysisId, pageNumber, pageWidthPx, pageHeightPx, "main_floorplan");
}

export function findDrawingAreaCrop(
  analysisId: string,
  pageNumber: number,
  pageWidthPx: number,
  pageHeightPx: number,
): NormalizedCrop | null {
  return findDrawingAreaRegion(analysisId, pageNumber, pageWidthPx, pageHeightPx)?.crop ?? null;
}

export function formatLayoutRegionSummary(info: LayoutRegionInfo): string {
  const pct = (info.areaFrac * 100).toFixed(1);
  return `${info.label} · ${Math.round(info.confidence * 100)}% conf · ${info.widthPx}×${info.heightPx} px (${pct}% of page)`;
}

/** True when px/m is not set — user still needs a drawing scale. */
export function scaleNeedsCalibration(scaleInfo: ScaleInfo | null | undefined): boolean {
  return !(scaleInfo?.pixelsPerMeter != null && scaleInfo.pixelsPerMeter > 0);
}

/** True when OCR scale should replace the current drawing scale (e.g. PDF 1:1 placeholder). */
export function shouldApplyOcrScale(scaleInfo: ScaleInfo | null | undefined): boolean {
  if (!scaleInfo) return true;
  if (!(scaleInfo.pixelsPerMeter != null && scaleInfo.pixelsPerMeter > 0)) return true;
  const method = scaleInfo.method ?? "";
  if (method === "manual_two_point" || method === "manual_scale_paper") {
    return false;
  }
  return true;
}

/** Parsed scale line from layout title-block OCR, if any. */
export function ocrScaleTextForPage(
  page: { ocrMeta?: SheetOcrMeta | null } | null | undefined,
): string | null {
  const meta = page?.ocrMeta;
  if (!meta) return null;
  const text = canonicalScaleText(meta.scaleText, meta.paperSize, meta.lines);
  if (text?.trim()) return text;
  const raw = meta.scaleText?.trim();
  return raw || null;
}

export function ocrPaperForPage(
  page: { ocrMeta?: SheetOcrMeta | null } | null | undefined,
): string | null {
  const meta = page?.ocrMeta;
  if (!meta) return null;
  const text = ocrScaleTextForPage(page);
  if (text) {
    const declPaper = parseScaleAndPaper(text)?.paper;
    if (declPaper) return declPaper;
  }
  if (meta.paperSize && meta.paperSize in A_PAPER_SIZES_MM) return meta.paperSize;
  if (meta.lines?.length) {
    for (const line of meta.lines) {
      const p = parsePaperFromText(line.text ?? "");
      if (p) return p;
    }
  }
  return null;
}

export function applyScaleFromOcrText(
  scaleText: string | null | undefined,
  scaleInfo: ScaleInfo | null | undefined,
  page:
    | { widthPx: number; heightPx: number; ocrMeta?: SheetOcrMeta | null }
    | null
    | undefined,
  apply: (opts: { scaleRatio: number; paper: string }) => void,
): boolean {
  if (!scaleText?.trim() || !page) return false;
  const decl = parseScaleAndPaper(scaleText);
  if (decl) {
    apply({ scaleRatio: decl.scale, paper: decl.paper });
    return true;
  }
  const ratio = parseScaleRatio(scaleText);
  if (ratio) {
    const paper =
      ocrPaperForPage(page) ??
      (scaleInfo?.paper && scaleInfo.paper in A_PAPER_SIZES_MM ? scaleInfo.paper : null) ??
      (scaleInfo?.paperFromPdf && scaleInfo.paperFromPdf in A_PAPER_SIZES_MM ? scaleInfo.paperFromPdf : null) ??
      parsePaperFromText(scaleText) ??
      "A3";
    apply({ scaleRatio: ratio, paper });
    return true;
  }
  return false;
}

export function remapOcrLinesToLayoutRegion(
  sheet: SheetOcrMeta,
  layoutCrop: NormalizedCrop,
  pageWidthPx: number,
  pageHeightPx: number,
  ocrCropWidthPx: number,
  ocrCropHeightPx: number,
): SheetOcrMeta {
  const rx = layoutCrop.x * pageWidthPx;
  const ry = layoutCrop.y * pageHeightPx;
  const rw = layoutCrop.width * pageWidthPx;
  const rh = layoutCrop.height * pageHeightPx;
  const sx = ocrCropWidthPx > 0 ? rw / ocrCropWidthPx : 1;
  const sy = ocrCropHeightPx > 0 ? rh / ocrCropHeightPx : 1;
  return {
    ...sheet,
    lines: (sheet.lines ?? []).map((line) => ({
      ...line,
      bbox:
        line.bbox?.map(([x, y]) => [rx + x * sx, ry + y * sy] as [number, number]) ?? line.bbox,
    })),
  };
}

export type PixelRect = { x: number; y: number; width: number; height: number };

/** Layout crop in overlay / viewer page pixels. */
export function layoutCropToPageRect(
  crop: NormalizedCrop,
  pageWidthPx: number,
  pageHeightPx: number,
): PixelRect {
  return {
    x: crop.x * pageWidthPx,
    y: crop.y * pageHeightPx,
    width: crop.width * pageWidthPx,
    height: crop.height * pageHeightPx,
  };
}

/** Map a crop-local OCR tile (pixels of the cropped raster) onto the page. */
export function mapCropTileToPage(
  crop: NormalizedCrop,
  tile: PixelRect,
  pageWidthPx: number,
  pageHeightPx: number,
  cropWidthPx: number,
  cropHeightPx: number,
): PixelRect {
  const region = layoutCropToPageRect(crop, pageWidthPx, pageHeightPx);
  const sx = cropWidthPx > 0 ? region.width / cropWidthPx : 1;
  const sy = cropHeightPx > 0 ? region.height / cropHeightPx : 1;
  return {
    x: region.x + tile.x * sx,
    y: region.y + tile.y * sy,
    width: tile.width * sx,
    height: tile.height * sy,
  };
}

/** @deprecated Use remapOcrLinesToLayoutRegion for cropped OCR aligned to layout boxes. */
export function remapOcrLinesToPage(
  sheet: SheetOcrMeta,
  crop: NormalizedCrop,
  pageWidthPx: number,
  pageHeightPx: number,
): SheetOcrMeta {
  const ox = crop.x * pageWidthPx;
  const oy = crop.y * pageHeightPx;
  return {
    ...sheet,
    lines: (sheet.lines ?? []).map((line) => ({
      ...line,
      bbox:
        line.bbox?.map(([x, y]) => [x + ox, y + oy] as [number, number]) ?? line.bbox,
    })),
  };
}

/** Crop a page image blob using normalized fractions. */
export async function cropImageBlob(blob: Blob, crop: NormalizedCrop): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const x0 = Math.max(0, Math.floor(crop.x * bitmap.width));
  const y0 = Math.max(0, Math.floor(crop.y * bitmap.height));
  const x1 = Math.min(bitmap.width, Math.ceil((crop.x + crop.width) * bitmap.width));
  const y1 = Math.min(bitmap.height, Math.ceil((crop.y + crop.height) * bitmap.height));
  const width = Math.max(1, x1 - x0);
  const height = Math.max(1, y1 - y0);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not crop page image.");
  ctx.drawImage(bitmap, x0, y0, width, height, 0, 0, width, height);
  bitmap.close();
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!out) throw new Error("Could not encode cropped page image.");
  return out;
}
