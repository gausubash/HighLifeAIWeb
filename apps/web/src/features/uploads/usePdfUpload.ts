"use client";

import { useCallback, useRef, useState } from "react";
import { z } from "zod";
import { createPageOnlyResult } from "@/lib/mock/createPageResult";
import { projectStore } from "@/lib/mock/store";
import { rasterImageGraphicsInfo } from "@/lib/pdf/classifyPdfGraphics";
import { putPageImage } from "@/lib/pdf/pageImageStore";
import { PDF_RENDER_DPI, PDF_RENDER_SCALE } from "@/lib/pdf/renderPdfFirstPage";
import { computeScaleInfo, type ScaleInfo } from "@/lib/scale/parseScale";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const ALLOWED_EXT = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp"]);

export const uploadSchema = z.object({
  file: z
    .instanceof(File)
    .refine((f) => {
      if (ALLOWED_TYPES.has(f.type)) return true;
      const ext = f.name.includes(".") ? f.name.slice(f.name.lastIndexOf(".")).toLowerCase() : "";
      return ALLOWED_EXT.has(ext);
    }, "Upload a PDF, PNG, JPG, or WEBP floor plan")
    .refine((f) => f.size <= MAX_FILE_SIZE_BYTES, "File must be under 50 MB"),
});

export type UploadValidationResult =
  | { ok: true; file: File }
  | { ok: false; error: string };

export function validatePdfUpload(file: File): UploadValidationResult {
  const result = uploadSchema.safeParse({ file });
  if (!result.success) {
    return { ok: false, error: result.error.errors[0]?.message ?? "Invalid file" };
  }
  return { ok: true, file: result.data.file };
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
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

function unknownScale(): ScaleInfo {
  return {
    scaleRatio: null,
    paper: null,
    paperFromPdf: null,
    pageWidthPt: 0,
    pageHeightPt: 0,
    pageWidthMm: 0,
    pageHeightMm: 0,
    method: "unknown",
    confidence: 0,
    pixelsPerMeter: null,
    scaleLabel: null,
  };
}

interface UsePdfUploadOptions {
  projectId: string;
  onComplete: (analysisId: string) => void;
}

export function usePdfUpload({ projectId, onComplete }: UsePdfUploadOptions) {
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      const validation = validatePdfUpload(file);
      if (!validation.ok) {
        setError(validation.error);
        return;
      }

      setUploading(true);
      setProgress(5);

      try {
        if (isPdf(file)) {
          const { renderAllPdfPagesToPng } = await import("@/lib/pdf/renderPdfFirstPage");
          const rendered = await renderAllPdfPagesToPng(file, {
            dpi: PDF_RENDER_DPI,
            onProgress: (done, total) => {
              setProgress(5 + Math.round((done / total) * 70));
            },
          });
          if (rendered.length === 0) {
            throw new Error("PDF has no pages.");
          }
          const first = rendered[0];
          const scaleInfo = computeScaleInfo({
            scaleText: first.textContent,
            pageWidthPt: first.pageWidthPt,
            pageHeightPt: first.pageHeightPt,
            renderWidthPx: first.widthPx,
            renderHeightPx: first.heightPx,
            renderScale: PDF_RENDER_SCALE,
          });
          setProgress(80);
          const analysis = projectStore.createAnalysis(projectId, file.name);
          const pageInputs = [];
          for (let i = 0; i < rendered.length; i++) {
            const p = rendered[i];
            const imageRef = await putPageImage(analysis.id, p.pageNumber, p.dataUrl);
            pageInputs.push({
              pageNumber: p.pageNumber,
              imageDataUrl: imageRef,
              widthPx: p.widthPx,
              heightPx: p.heightPx,
              graphicsKind: p.graphics.kind,
              graphicsSummary: p.graphics.summary,
            });
            setProgress(80 + Math.round(((i + 1) / rendered.length) * 15));
          }
          projectStore.updateAnalysis(analysis.id, {
            status: "completed",
            currentStage: "completed",
            progress: 100,
            pageCount: rendered.length,
            completedAt: new Date().toISOString(),
          });
          projectStore.setResult(
            analysis.id,
            createPageOnlyResult({
              analysisId: analysis.id,
              projectId,
              fileName: file.name,
              pages: pageInputs,
              scaleInfo,
            }),
          );
          projectStore.setScaleInfo(analysis.id, scaleInfo);
          setProgress(100);
          onComplete(analysis.id);
          return;
        }

        const dataUrl = await fileToDataUrl(file);
        setProgress(40);
        const { widthPx, heightPx } = await measureDataUrl(dataUrl);
        if (widthPx < 1 || heightPx < 1) {
          throw new Error("Image has no pixel dimensions.");
        }
        setProgress(70);
        const analysis = projectStore.createAnalysis(projectId, file.name);
        const imageRef = await putPageImage(analysis.id, 1, dataUrl);
        const scaleInfo = unknownScale();
        projectStore.updateAnalysis(analysis.id, {
          status: "completed",
          currentStage: "completed",
          progress: 100,
          pageCount: 1,
          completedAt: new Date().toISOString(),
        });
        const imageGraphics = rasterImageGraphicsInfo();
        projectStore.setResult(
          analysis.id,
          createPageOnlyResult({
            analysisId: analysis.id,
            projectId,
            fileName: file.name,
            pages: [
              {
                pageNumber: 1,
                imageDataUrl: imageRef,
                widthPx,
                heightPx,
                graphicsKind: imageGraphics.kind,
                graphicsSummary: imageGraphics.summary,
              },
            ],
            scaleInfo,
          }),
        );
        projectStore.setScaleInfo(analysis.id, scaleInfo);
        setProgress(100);
        onComplete(analysis.id);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Upload failed";
        setError(message);
      } finally {
        setUploading(false);
      }
    },
    [projectId, onComplete],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) void upload(file);
    },
    [upload],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void upload(file);
    },
    [upload],
  );

  return {
    error,
    progress,
    uploading,
    inputRef,
    handleDrop,
    handleFileChange,
    openFilePicker: () => inputRef.current?.click(),
  };
}

/** @deprecated Use usePdfUpload */
export const useMockUpload = usePdfUpload;
