import type { AnalysisResult, PlanPage } from "@highlife/shared-types";
import { projectStore } from "@/lib/data/projectStore";
import { rasterImageGraphicsInfo } from "@/lib/pdf/classifyPdfGraphics";
import { putPageImageBlob } from "@/lib/pdf/pageImageStore";
import {
  PDF_RENDER_DPI,
  clampPdfUploadDpi,
  pdfRenderScale,
  renderAllPdfPagesToPng,
} from "@/lib/pdf/renderPdfFirstPage";
import { computeScaleInfo } from "@/lib/scale/parseScale";
import { derivePlanStoragePath, planImageRef, uploadPlanObject } from "@/lib/supabase/plans";
import { validatePdfUpload } from "@/features/uploads/usePdfUpload";

type RenderedPage = {
  pageNumber: number;
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  graphics: { kind: PlanPage["graphicsKind"]; summary: string };
  textContent?: string;
  pageWidthPt?: number;
  pageHeightPt?: number;
};

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(",", 2);
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? "image/png";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

function measureDataUrl(dataUrl: string): Promise<{ widthPx: number; heightPx: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ widthPx: img.naturalWidth, heightPx: img.naturalHeight });
    img.onerror = () => reject(new Error("Could not decode the image."));
    img.src = dataUrl;
  });
}

function levelNameFromFile(fileName: string, pageNumber: number, levelIndex: number): string {
  const base = fileName.replace(/\.[^.]+$/i, "").replace(/[_-]+/g, " ").trim();
  if (/floor|level|storey|lvl|ground|basement|roof/i.test(base)) return base;
  return `Floor ${levelIndex + 1}`;
}

function nextPageSlot(pages: PlanPage[]): { nextPageNumber: number; nextLevelIndex: number } {
  const nextPageNumber = pages.reduce((max, p) => Math.max(max, p.pageNumber), 0) + 1;
  const nextLevelIndex = pages.reduce((max, p) => Math.max(max, p.levelIndex ?? p.pageNumber - 1), -1) + 1;
  return { nextPageNumber, nextLevelIndex };
}

async function renderedPagesFromFile(
  file: File,
  startPageNumber: number,
  dpi: number,
): Promise<RenderedPage[]> {
  if (isPdf(file)) {
    const rendered = await renderAllPdfPagesToPng(file, { dpi });
    return rendered.map((p, index) => ({
      pageNumber: startPageNumber + index,
      dataUrl: p.dataUrl,
      widthPx: p.widthPx,
      heightPx: p.heightPx,
      graphics: { kind: p.graphics.kind, summary: p.graphics.summary },
      textContent: p.textContent,
      pageWidthPt: p.pageWidthPt,
      pageHeightPt: p.pageHeightPt,
    }));
  }

  const dataUrl = await fileToDataUrl(file);
  const { widthPx, heightPx } = await measureDataUrl(dataUrl);
  if (widthPx < 1 || heightPx < 1) throw new Error(`${file.name}: image has no pixel dimensions.`);
  const imageGraphics = rasterImageGraphicsInfo();
  return [
    {
      pageNumber: startPageNumber,
      dataUrl,
      widthPx,
      heightPx,
      graphics: { kind: imageGraphics.kind, summary: imageGraphics.summary },
    },
  ];
}

export type AppendDrawingPagesResult = {
  addedPages: PlanPage[];
  result: AnalysisResult;
};

/**
 * Append PDF pages or image files to an existing drawing.
 * Supports multi-page PDFs (one sheet per page) and one image = one floor.
 */
export async function appendDrawingPages(args: {
  analysisId: string;
  projectId: string;
  files: File[];
  dpi?: number;
}): Promise<AppendDrawingPagesResult> {
  const { analysisId, projectId, files } = args;
  if (!files.length) throw new Error("Choose at least one PDF or image file.");

  for (const file of files) {
    const validation = validatePdfUpload(file);
    if (!validation.ok) throw new Error(validation.error);
  }

  const result = projectStore.getResult(analysisId);
  if (!result) throw new Error("Drawing not loaded.");

  const analysis = projectStore.getAnalysis(analysisId);
  const storageFolder =
    analysis?.storagePath ??
    derivePlanStoragePath(result.pages[0]?.imagePath) ??
    null;
  if (!storageFolder) {
    throw new Error("Could not resolve storage folder for this drawing.");
  }

  const dpi = clampPdfUploadDpi(args.dpi ?? PDF_RENDER_DPI);
  const existing = [...result.pages];
  const addedPages: PlanPage[] = [];
  let slot = nextPageSlot(existing);
  let scaleSeed: RenderedPage | null = null;

  for (const file of files) {
    const rendered = await renderedPagesFromFile(file, slot.nextPageNumber, dpi);
    if (!scaleSeed && rendered[0]) scaleSeed = rendered[0];
    for (let i = 0; i < rendered.length; i++) {
      const p = rendered[i];
      const levelIndex = slot.nextLevelIndex + i;
      const blob = dataUrlToBlob(p.dataUrl);
      await putPageImageBlob(analysisId, p.pageNumber, blob);
      const objectPath = `${storageFolder}/page-${p.pageNumber}.png`;
      await uploadPlanObject(objectPath, blob, "image/png");

      const scaleMPerPixel = result.pages[0]?.scaleMPerPixel;
      addedPages.push({
        id: `page-${String(p.pageNumber).padStart(3, "0")}`,
        pageNumber: p.pageNumber,
        imagePath: planImageRef(objectPath),
        widthPx: p.widthPx,
        heightPx: p.heightPx,
        isFloorPlan: true,
        scaleMPerPixel,
        scaleSource: result.pages[0]?.scaleSource,
        scaleConfidence: result.pages[0]?.scaleConfidence,
        graphicsKind: p.graphics.kind,
        graphicsSummary: p.graphics.summary,
        sourceFileName: file.name,
        levelName: levelNameFromFile(file.name, p.pageNumber, levelIndex),
        levelIndex,
        floorId: `floor-page-${String(p.pageNumber).padStart(3, "0")}`,
      });
    }

    slot = nextPageSlot([...existing, ...addedPages]);
  }

  const nextResult: AnalysisResult = {
    ...result,
    pages: [...existing, ...addedPages].sort((a, b) => a.pageNumber - b.pageNumber),
  };

  await projectStore.setResult(analysisId, nextResult);
  await projectStore.updateAnalysis(analysisId, { pageCount: nextResult.pages.length });

  const scaleInfo = projectStore.getScaleInfo(analysisId);
  if (
    scaleInfo &&
    !(scaleInfo.pixelsPerMeter != null && scaleInfo.pixelsPerMeter > 0) &&
    scaleSeed?.pageWidthPt &&
    scaleSeed.pageHeightPt
  ) {
    const nextScale = computeScaleInfo({
      scaleText: scaleSeed.textContent,
      pageWidthPt: scaleSeed.pageWidthPt,
      pageHeightPt: scaleSeed.pageHeightPt,
      renderWidthPx: scaleSeed.widthPx,
      renderHeightPx: scaleSeed.heightPx,
      renderScale: pdfRenderScale(dpi),
    });
    if (nextScale.pixelsPerMeter) {
      await projectStore.setScaleInfo(analysisId, nextScale);
    }
  }

  return { addedPages, result: nextResult };
}
