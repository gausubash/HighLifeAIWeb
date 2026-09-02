import type { PageOcrMeta } from "@highlife/shared-types";
"use client";

import { pageKey, useOverlayStore } from "@/features/plan-editor/useOverlayStore";
import { projectStore } from "@/lib/data/projectStore";
import { inferUnitBoundaries } from "@/lib/hierarchy/inferUnitBoundaries";
import { ensureOcrLinesInPageSpace, findDrawingAreaCrop } from "@/lib/scale/layoutRegionCrop";
import { mainDoorWidthOptsFromStore } from "@/features/plan-editor/useMainDoorDetectionStore";

export function applyUnitBoundariesFromPage(opts: {
  analysisId: string;
  pageNumber: number;
  widthPx: number;
  heightPx: number;
  drawingOcrMeta?: PageOcrMeta | null;
}): { created: number; labeled: number } {
  const { analysisId, pageNumber, widthPx, heightPx, drawingOcrMeta } = opts;
  if (widthPx < 1 || heightPx < 1) return { created: 0, labeled: 0 };
  const key = pageKey(analysisId, pageNumber);
  const entities = useOverlayStore.getState().pages[key]?.entities ?? [];
  const crop = findDrawingAreaCrop(analysisId, pageNumber, widthPx, heightPx);
  const pageSpaceOcr = ensureOcrLinesInPageSpace(drawingOcrMeta, crop, widthPx, heightPx);
  const result = inferUnitBoundaries({
    entities,
    drawingOcrMeta: pageSpaceOcr,
    widthPx,
    heightPx,
    pageNumber,
    mainDoorWidth: mainDoorWidthOptsFromStore(),
  });
  useOverlayStore.getState().upsertInferredUnitBoundaries(
    result.createdEntities,
    result.yoloLabelPatches,
    { analysisId, pageNumber },
  );
  const all = useOverlayStore.getState().pages[key]?.entities ?? [];
  void projectStore.setOverlays(analysisId, pageNumber, all);
  return { created: result.createdEntities.length, labeled: result.yoloLabelPatches.length };
}
