"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detectPageRegions } from "@/lib/api/floorPlanClient";
import { detectedRegionToOverlay } from "./detectedToOverlay";
import { rasterBlobForDetect } from "./rasterBlobForDetect";
import { pageKey, useOverlayStore } from "./useOverlayStore";

interface UsePageRegionDetectOptions {
  analysisId: string;
  pageNumber: number;
  imageUrl: string | null;
  widthPx: number;
  heightPx: number;
  enabled: boolean;
}

export function usePageRegionDetect({
  analysisId,
  pageNumber,
  imageUrl,
  widthPx,
  heightPx,
  enabled,
}: UsePageRegionDetectOptions) {
  const setModelPredictions = useOverlayStore((s) => s.setModelPredictions);
  const regionCount = useOverlayStore((s) => {
    const slice = s.pages[pageKey(s.analysisId, s.pageNumber)];
    if (!slice) return 0;
    return slice.entities.filter((e) => e.source === "model").length;
  });
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [detectWarning, setDetectWarning] = useState<string | null>(null);
  const [modelLabel, setModelLabel] = useState<string | null>(null);
  const attempted = useRef<Record<string, boolean>>({});

  const runDetect = useCallback(async () => {
    if (!imageUrl || widthPx < 1 || heightPx < 1) return;
    setDetecting(true);
    setDetectError(null);
    try {
      const blob = await rasterBlobForDetect(imageUrl);
      const result = await detectPageRegions({
        image: blob,
        originalWidth: widthPx,
        originalHeight: heightPx,
      });
      setModelPredictions(
        result.regions.map((region) => detectedRegionToOverlay(region)),
        { analysisId, pageNumber },
      );
      setDetectWarning(result.warning);
      setModelLabel(`${result.modelId} ${result.modelVersion}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Detection failed";
      const offline =
        message.includes("Failed to fetch") ||
        message.includes("NetworkError") ||
        message.includes("Load failed");
      setDetectError(
        offline
          ? "YOLO inference is not running on :8000. Start uvicorn in services/inference."
          : message,
      );
    } finally {
      setDetecting(false);
    }
  }, [analysisId, pageNumber, imageUrl, widthPx, heightPx, setModelPredictions]);

  useEffect(() => {
    if (!enabled || !imageUrl) return;
    const key = `${analysisId}:${pageNumber}:${imageUrl}`;
    if (attempted.current[key]) return;
    attempted.current[key] = true;
    void runDetect();
  }, [enabled, imageUrl, analysisId, pageNumber, runDetect]);

  return {
    detecting,
    detectError,
    detectWarning,
    modelLabel,
    regionCount,
    runDetect,
  };
}
