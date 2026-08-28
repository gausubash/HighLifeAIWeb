"use client";

import { clsx } from "clsx";
import type { PlanEntityType } from "@highlife/shared-types";
import {
  findDrawingAreaRegion,
  findLayoutRegion,
  findTitleBlockRegion,
  formatLayoutRegionSummary,
} from "@/lib/scale/layoutRegionCrop";
import {
  isLayoutRegionType,
  LAYOUT_REGION_TYPES,
  layoutRegionLabel,
  type LayoutRegionKind,
} from "./layoutRegionClasses";
import { pageKey, useOverlayStore } from "./useOverlayStore";

type ManualLayoutPanelProps = {
  analysisId: string;
  pageNumber: number;
  pageWidthPx: number;
  pageHeightPx: number;
  disabled?: boolean;
};

function regionForType(
  analysisId: string,
  pageNumber: number,
  pageWidthPx: number,
  pageHeightPx: number,
  type: LayoutRegionKind,
) {
  if (type === "title_block") {
    return findTitleBlockRegion(analysisId, pageNumber, pageWidthPx, pageHeightPx);
  }
  if (type === "main_floorplan") {
    return findDrawingAreaRegion(analysisId, pageNumber, pageWidthPx, pageHeightPx);
  }
  return findLayoutRegion(analysisId, pageNumber, pageWidthPx, pageHeightPx, type);
}

function clearManualLayoutRegion(
  analysisId: string,
  pageNumber: number,
  type: PlanEntityType,
) {
  const key = pageKey(analysisId, pageNumber);
  const slice = useOverlayStore.getState().pages[key];
  const toRemove = (slice?.entities ?? []).filter(
    (e) => e.type === type && e.source === "manual" && e.status !== "rejected",
  );
  if (toRemove.length > 0) {
    useOverlayStore.getState().execute({ type: "remove", entities: toRemove });
  }
}

export function ManualLayoutPanel({
  analysisId,
  pageNumber,
  pageWidthPx,
  pageHeightPx,
  disabled = false,
}: ManualLayoutPanelProps) {
  const layoutDrawType = useOverlayStore((s) => s.layoutDrawType);
  const setLayoutDrawType = useOverlayStore((s) => s.setLayoutDrawType);
  const entities =
    useOverlayStore((s) => s.pages[pageKey(analysisId, pageNumber)]?.entities) ?? [];

  const manualLayoutCount = entities.filter(
    (e) => e.source === "manual" && isLayoutRegionType(e.type) && e.status !== "rejected",
  ).length;

  return (
    <div className="space-y-2 rounded border border-slate-200 px-3 py-2">
      <p className="text-[11px] font-medium text-slate-700">Manual layout regions</p>
      <p className="text-[11px] leading-relaxed text-slate-500">
        Use <strong>Title box</strong> in the top toolbar (or Draw below), then drag a rectangle on
        the plan. Manual regions are preferred over YOLO detections for OCR.
      </p>
      {layoutDrawType ? (
        <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
          Draw a rectangle for <strong>{layoutRegionLabel(layoutDrawType)}</strong> on the plan.
          Esc cancels.
        </p>
      ) : null}
      <ul className="space-y-2">
        {LAYOUT_REGION_TYPES.map((item) => {
          const region = regionForType(
            analysisId,
            pageNumber,
            pageWidthPx,
            pageHeightPx,
            item.type,
          );
          const manual = entities.some(
            (e) =>
              e.type === item.type && e.source === "manual" && e.status !== "rejected",
          );
          const drawing = layoutDrawType === item.type;
          return (
            <li
              key={item.type}
              className="rounded border border-slate-100 bg-slate-50/80 px-2 py-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-slate-800">{item.label}</p>
                  <p className="text-[10px] leading-snug text-slate-500">{item.hint}</p>
                  {region ? (
                    <p className="mt-1 text-[10px] leading-snug text-teal-800">
                      {formatLayoutRegionSummary(region)}
                      {manual ? " · manual" : region.confidence < 1 ? " · detected" : ""}
                    </p>
                  ) : (
                    <p className="mt-1 text-[10px] text-amber-700">Not set on this page</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    disabled={disabled}
                    className={clsx(
                      "rounded border px-2 py-1 text-[10px] font-medium",
                      drawing
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-300 text-slate-800 hover:bg-white",
                    )}
                    onClick={() =>
                      setLayoutDrawType(drawing ? null : item.type)
                    }
                  >
                    {drawing ? "Drawing…" : "Draw on plan"}
                  </button>
                  {manual ? (
                    <button
                      type="button"
                      disabled={disabled}
                      className="rounded border border-slate-300 px-2 py-1 text-[10px] text-slate-600 hover:bg-white"
                      onClick={() => clearManualLayoutRegion(analysisId, pageNumber, item.type)}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {manualLayoutCount > 0 ? (
        <p className="text-[10px] text-slate-500">
          {manualLayoutCount} manual layout region{manualLayoutCount === 1 ? "" : "s"} on this page.
        </p>
      ) : null}
    </div>
  );
}
