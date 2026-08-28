"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DetectStreamCancelled,
  detectPageRegionsStream,
  LAYOUT_DETECT_MODEL,
  type DetectTileRect,
} from "@/lib/api/floorPlanClient";
import { findDrawingAreaCrop } from "@/lib/scale/layoutRegionCrop";
import { resolvePageImagePath } from "@/lib/pdf/pageImageStore";
import { projectStore } from "@/lib/data/projectStore";
import {
  readStoredDetectModel,
  writeStoredDetectModel,
} from "./DetectModelSelect";
import { detectedRegionToOverlay } from "./detectedToOverlay";
import { isLayoutEntity } from "./layoutRegionClasses";
import { rasterBlobForDetect } from "./rasterBlobForDetect";
import { pageKey, useOverlayStore } from "./useOverlayStore";
import type { OverlayEntity } from "./types";

const AUTO_DETECT_STORAGE_KEY = "highlife-auto-detect";

export function readStoredAutoDetect(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(AUTO_DETECT_STORAGE_KEY) === "1";
}

export function writeStoredAutoDetect(enabled: boolean): void {
  localStorage.setItem(AUTO_DETECT_STORAGE_KEY, enabled ? "1" : "0");
}

interface UsePageRegionDetectOptions {
  analysisId: string;
  pageNumber: number;
  imageUrl: string | null;
  widthPx: number;
  heightPx: number;
  enabled: boolean;
  graphicsKind?: "vector" | "raster" | "hybrid" | "image" | "unknown";
  sourceFileName?: string;
  sourceStoragePath?: string;
  /** All pages in the drawing — used for batch layout detection. */
  allPages?: {
    pageNumber: number;
    widthPx: number;
    heightPx: number;
    imagePath: string;
  }[];
}

export type DetectProgress = {
  index: number;
  total: number;
  tiled: boolean;
  tile: DetectTileRect | null;
  label: string;
  pageNumber?: number;
  batchIndex?: number;
  batchTotal?: number;
};

export function usePageRegionDetect({
  analysisId,
  pageNumber,
  imageUrl,
  widthPx,
  heightPx,
  enabled,
  graphicsKind,
  sourceFileName,
  sourceStoragePath,
  allPages = [],
}: UsePageRegionDetectOptions) {
  const setModelPredictions = useOverlayStore((s) => s.setModelPredictions);
  const regionCount = useOverlayStore((s) => {
    const slice = s.pages[pageKey(s.analysisId, s.pageNumber)];
    if (!slice) return 0;
    return slice.entities.filter((e) => e.source === "model" && !isLayoutEntity(e)).length;
  });
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [detectWarning, setDetectWarning] = useState<string | null>(null);
  const [modelLabel, setModelLabel] = useState<string | null>(null);
  const [detectModelId, setDetectModelId] = useState(() => readStoredDetectModel() ?? "");
  const [autoDetect, setAutoDetectState] = useState(() => readStoredAutoDetect());
  const [progress, setProgress] = useState<DetectProgress | null>(null);
  const attempted = useRef<Record<string, boolean>>({});
  const abortRef = useRef<AbortController | null>(null);
  const partialRef = useRef<OverlayEntity[]>([]);

  const setAutoDetect = useCallback((next: boolean) => {
    writeStoredAutoDetect(next);
    setAutoDetectState(next);
  }, []);

  const cancelDetect = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const runDetectWithModel = useCallback(
    async (modelId: string): Promise<boolean> => {
      if (!imageUrl || widthPx < 1 || heightPx < 1) return false;
      if (!modelId) {
        setDetectError("Pick a detection model first.");
        return false;
      }
      const isLayoutModel = modelId === LAYOUT_DETECT_MODEL;
      const drawingCrop =
        !isLayoutModel
          ? findDrawingAreaCrop(analysisId, pageNumber, widthPx, heightPx)
          : null;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setDetecting(true);
      setDetectError(null);
      setDetectWarning(null);
      setProgress({ index: 0, total: 0, tiled: false, tile: null, label: "Preparing…" });
      partialRef.current = [];
      setModelPredictions([], { analysisId, pageNumber });
      try {
        if (modelId === "wall:vector_pdf") {
          setProgress({ index: 0, total: 1, tiled: false, tile: null, label: "Reading vector PDF…" });
          const { detectVectorPdfWalls } = await import("@/lib/pdf/extractVectorWalls");
          const result = await detectVectorPdfWalls({
            storagePath: sourceStoragePath ?? "",
            sourceFileName: sourceFileName ?? "",
            pageNumber,
            targetWidthPx: widthPx,
            targetHeightPx: heightPx,
            graphicsKind,
            signal: ac.signal,
          });
          if (ac.signal.aborted) throw new DetectStreamCancelled();
          const entities = result.regions.map((region) => detectedRegionToOverlay(region));
          setModelPredictions(entities, { analysisId, pageNumber });
          const all =
            useOverlayStore.getState().pages[pageKey(analysisId, pageNumber)]?.entities ?? entities;
          void projectStore.setOverlays(analysisId, pageNumber, all);
          setDetectWarning(result.warning);
          setModelLabel("vector_pdf local");
          setProgress(null);
          return true;
        }
        const blob = await rasterBlobForDetect(imageUrl);
        if (ac.signal.aborted) throw new DetectStreamCancelled();
        if (!isLayoutModel && !drawingCrop) {
          setDetectWarning(
            "No drawing area region — run layout detect on the Layout tab or draw a drawing area box first. Detection will run on the full page without tiling.",
          );
        }
        const result = await detectPageRegionsStream(
          {
            image: blob,
            originalWidth: widthPx,
            originalHeight: heightPx,
            detectModel: modelId,
            drawingCrop,
            signal: ac.signal,
          },
          {
            onMeta: (meta) => {
              setProgress({
                index: 0,
                total: meta.tileCount,
                tiled: meta.tiled,
                tile: null,
                label: meta.tiled
                  ? `Tiling ${meta.tileCount} windows…`
                  : "Running detection…",
              });
            },
            onStatus: (message) => {
              setProgress((prev) =>
                prev
                  ? { ...prev, tile: null, label: message }
                  : { index: 0, total: 0, tiled: false, tile: null, label: message },
              );
            },
            onTileStart: (ev) => {
              setProgress({
                index: ev.index,
                total: ev.total,
                tiled: ev.total > 1,
                tile: ev.tile,
                label:
                  ev.total > 1
                    ? `Tile ${ev.index} / ${ev.total}`
                    : "Running detection…",
              });
            },
            onTileDone: (ev) => {
              if (ev.regions?.length) {
                const next = [
                  ...partialRef.current,
                  ...ev.regions.map((region) => detectedRegionToOverlay(region)),
                ];
                partialRef.current = next;
                setModelPredictions(next, { analysisId, pageNumber });
              }
              const last = ev.index >= ev.total;
              setProgress({
                index: ev.index,
                total: ev.total,
                tiled: ev.total > 1,
                tile: last ? null : ev.tile,
                label: last
                  ? "Finishing…"
                  : ev.total > 1
                    ? `Tile ${ev.index} / ${ev.total} · ${ev.regionCount ?? 0} hits`
                    : "Finishing…",
              });
            },
          },
        );
        const entities = result.regions.map((region) => detectedRegionToOverlay(region));
        setModelPredictions(entities, { analysisId, pageNumber });
        const all =
          useOverlayStore.getState().pages[pageKey(analysisId, pageNumber)]?.entities ?? entities;
        void projectStore.setOverlays(analysisId, pageNumber, all);
        setDetectWarning(result.warning);
        setModelLabel(`${result.modelId} ${result.modelVersion}`);
        setProgress(null);
        return true;
      } catch (e) {
        if (e instanceof DetectStreamCancelled || (e instanceof Error && e.name === "AbortError")) {
          setDetectWarning("Detection cancelled.");
          setProgress(null);
          return false;
        }
        const message = e instanceof Error ? e.message : "Detection failed";
        const offline =
          message.includes("Failed to fetch") ||
          message.includes("NetworkError") ||
          message.includes("Load failed");
        setDetectError(
          offline
            ? "Inference API is not running on :8000. Start uvicorn in services/inference."
            : message,
        );
        setProgress(null);
        return false;
      } finally {
        if (abortRef.current === ac) abortRef.current = null;
        setDetecting(false);
      }
    },
    [
      analysisId,
      pageNumber,
      imageUrl,
      widthPx,
      heightPx,
      graphicsKind,
      sourceFileName,
      sourceStoragePath,
      setModelPredictions,
    ],
  );

  const runDetect = useCallback(async () => runDetectWithModel(detectModelId), [detectModelId, runDetectWithModel]);

  const runLayoutDetect = useCallback(
    async () => runDetectWithModel(LAYOUT_DETECT_MODEL),
    [runDetectWithModel],
  );

  const runLayoutDetectAllPages = useCallback(async (): Promise<boolean> => {
    const targets = allPages.filter((p) => p.widthPx >= 1 && p.heightPx >= 1 && p.imagePath);
    if (!targets.length) {
      setDetectError("No page images available for layout detection.");
      return false;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setDetecting(true);
    setDetectError(null);
    setDetectWarning(null);
    setProgress({
      index: 0,
      total: targets.length,
      tiled: false,
      tile: null,
      label: `Preparing layout detection (${targets.length} pages)…`,
      batchIndex: 0,
      batchTotal: targets.length,
    });

    let successCount = 0;
    let lastWarning: string | null = null;
    let lastModelLabel: string | null = null;

    try {
      for (let i = 0; i < targets.length; i++) {
        if (ac.signal.aborted) break;
        const target = targets[i];
        const batchIndex = i + 1;
        setProgress({
          index: batchIndex,
          total: targets.length,
          tiled: false,
          tile: null,
          label: `Page ${target.pageNumber} (${batchIndex}/${targets.length}): loading…`,
          pageNumber: target.pageNumber,
          batchIndex,
          batchTotal: targets.length,
        });
        const imageUrl = await resolvePageImagePath(
          target.imagePath,
          analysisId,
          target.pageNumber,
        );
        const blob = await rasterBlobForDetect(imageUrl);
        if (ac.signal.aborted) throw new DetectStreamCancelled();

        partialRef.current = [];
        setModelPredictions([], { analysisId, pageNumber: target.pageNumber });

        setProgress({
          index: batchIndex,
          total: targets.length,
          tiled: false,
          tile: null,
          label: `Page ${target.pageNumber} (${batchIndex}/${targets.length}): detecting layout…`,
          pageNumber: target.pageNumber,
          batchIndex,
          batchTotal: targets.length,
        });

        const result = await detectPageRegionsStream(
          {
            image: blob,
            originalWidth: target.widthPx,
            originalHeight: target.heightPx,
            detectModel: LAYOUT_DETECT_MODEL,
            drawingCrop: null,
            signal: ac.signal,
          },
          {
            onMeta: (meta) => {
              setProgress({
                index: batchIndex,
                total: targets.length,
                tiled: meta.tiled,
                tile: null,
                label: meta.tiled
                  ? `Page ${target.pageNumber} (${batchIndex}/${targets.length}): tiling ${meta.tileCount} windows…`
                  : `Page ${target.pageNumber} (${batchIndex}/${targets.length}): detecting layout…`,
                pageNumber: target.pageNumber,
                batchIndex,
                batchTotal: targets.length,
              });
            },
            onStatus: (message) => {
              setProgress((prev) =>
                prev
                  ? {
                      ...prev,
                      tile: null,
                      label: `Page ${target.pageNumber} (${batchIndex}/${targets.length}): ${message}`,
                    }
                  : {
                      index: batchIndex,
                      total: targets.length,
                      tiled: false,
                      tile: null,
                      label: message,
                      pageNumber: target.pageNumber,
                      batchIndex,
                      batchTotal: targets.length,
                    },
              );
            },
            onTileStart: (ev) => {
              setProgress({
                index: batchIndex,
                total: targets.length,
                tiled: ev.total > 1,
                tile: ev.tile,
                label:
                  ev.total > 1
                    ? `Page ${target.pageNumber} (${batchIndex}/${targets.length}): tile ${ev.index}/${ev.total}`
                    : `Page ${target.pageNumber} (${batchIndex}/${targets.length}): detecting layout…`,
                pageNumber: target.pageNumber,
                batchIndex,
                batchTotal: targets.length,
              });
            },
            onTileDone: (ev) => {
              if (ev.regions?.length) {
                const next = [
                  ...partialRef.current,
                  ...ev.regions.map((region) => detectedRegionToOverlay(region)),
                ];
                partialRef.current = next;
                setModelPredictions(next, { analysisId, pageNumber: target.pageNumber });
              }
              const last = ev.index >= ev.total;
              setProgress({
                index: batchIndex,
                total: targets.length,
                tiled: ev.total > 1,
                tile: last ? null : ev.tile,
                label: last
                  ? `Page ${target.pageNumber} (${batchIndex}/${targets.length}): saving…`
                  : ev.total > 1
                    ? `Page ${target.pageNumber} (${batchIndex}/${targets.length}): tile ${ev.index}/${ev.total}`
                    : `Page ${target.pageNumber} (${batchIndex}/${targets.length}): finishing…`,
                pageNumber: target.pageNumber,
                batchIndex,
                batchTotal: targets.length,
              });
            },
          },
        );

        const entities = result.regions.map((region) => detectedRegionToOverlay(region));
        setModelPredictions(entities, { analysisId, pageNumber: target.pageNumber });
        const all =
          useOverlayStore.getState().pages[pageKey(analysisId, target.pageNumber)]?.entities ??
          entities;
        await projectStore.setOverlays(analysisId, target.pageNumber, all);
        if (entities.length > 0) successCount += 1;
        lastWarning = result.warning ?? null;
        lastModelLabel = `${result.modelId} ${result.modelVersion}`;
      }

      if (ac.signal.aborted) {
        setDetectWarning("Layout detection cancelled.");
        return false;
      }

      setModelLabel(lastModelLabel);
      setDetectWarning(
        successCount === targets.length
          ? `Layout detected on all ${targets.length} page${targets.length === 1 ? "" : "s"}.${lastWarning ? ` ${lastWarning}` : ""}`
          : `Layout detected on ${successCount} of ${targets.length} pages.${lastWarning ? ` ${lastWarning}` : ""}`,
      );
      setProgress(null);
      return successCount > 0;
    } catch (e) {
      if (e instanceof DetectStreamCancelled || (e instanceof Error && e.name === "AbortError")) {
        setDetectWarning("Layout detection cancelled.");
        setProgress(null);
        return false;
      }
      const message = e instanceof Error ? e.message : "Layout detection failed";
      const offline =
        message.includes("Failed to fetch") ||
        message.includes("NetworkError") ||
        message.includes("Load failed");
      setDetectError(
        offline
          ? "Inference API is not running on :8000. Start uvicorn in services/inference."
          : message,
      );
      setProgress(null);
      return false;
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setDetecting(false);
    }
  }, [allPages, analysisId, setModelPredictions]);

  const selectDetectModel = useCallback((id: string) => {
    writeStoredDetectModel(id);
    setDetectModelId(id);
  }, []);

  useEffect(() => {
    if (!autoDetect || !enabled || !imageUrl || !detectModelId) return;
    const key = `${analysisId}:${pageNumber}:${imageUrl}:${detectModelId}`;
    if (attempted.current[key]) return;
    const existing = useOverlayStore.getState().pages[pageKey(analysisId, pageNumber)];
    if (existing?.entities.some((e) => e.source === "model")) {
      attempted.current[key] = true;
      return;
    }
    attempted.current[key] = true;
    void runDetect();
  }, [autoDetect, enabled, imageUrl, analysisId, pageNumber, detectModelId, runDetect]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return {
    detecting,
    detectError,
    detectWarning,
    modelLabel,
    regionCount,
    detectModelId,
    selectDetectModel,
    runDetect,
    runLayoutDetect,
    runLayoutDetectAllPages,
    cancelDetect,
    progress,
    autoDetect,
    setAutoDetect,
  };
}
