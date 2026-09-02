"use client";

import { useMemo } from "react";
import { HoverHint } from "@/components/ui/HoverHint";
import { OCR_OVERLAY_FONT_MAX, OCR_OVERLAY_FONT_MIN } from "@/features/plan-viewer/ocrOverlayFont";
import { useViewerStore } from "@/features/plan-viewer/useViewerStore";
import {
  OVERLAY_VISIBILITY_GROUPS,
  overlayGroupFor,
  type OverlayEntityGroup,
  type OverlayVisibilityGroup,
} from "./overlayVisibility";
import { isNorthArrowEntity } from "./compassKeypointAnnotate";
import { CompassKeypointToggles } from "./CompassKeypointToggles";
import { useActiveOverlayPage, useOverlayStore } from "./useOverlayStore";

const SWATCH: Record<OverlayVisibilityGroup, string> = {
  layout: "#0f766e",
  ocr: "#4f46e5",
  walls: "#ca8a04",
  rooms: "#2563eb",
  openings: "#16a34a",
  objects: "#ea580c",
  units: "#a855f7",
};

export function OverlayViewSection({ hasOcr = false }: { hasOcr?: boolean }) {
  const { entities } = useActiveOverlayPage();
  const groupVisible = useOverlayStore((s) => s.groupVisible);
  const toggleOverlayGroup = useOverlayStore((s) => s.toggleOverlayGroup);
  const showOcrText = useViewerStore((s) => s.showOcrText);
  const toggleShowOcrText = useViewerStore((s) => s.toggleShowOcrText);
  const showPageImage = useViewerStore((s) => s.showPageImage);
  const toggleShowPageImage = useViewerStore((s) => s.toggleShowPageImage);
  const pageImageOpacity = useViewerStore((s) => s.pageImageOpacity);
  const setPageImageOpacity = useViewerStore((s) => s.setPageImageOpacity);
  const ocrFontSize = useViewerStore((s) => s.ocrFontSize);
  const setOcrFontSize = useViewerStore((s) => s.setOcrFontSize);

  const counts = useMemo(() => {
    const next: Record<OverlayEntityGroup, number> = {
      layout: 0,
      walls: 0,
      rooms: 0,
      openings: 0,
      objects: 0,
      units: 0,
    };
    for (const entity of entities) {
      if (entity.status === "rejected") continue;
      next[overlayGroupFor(entity)] += 1;
    }
    return next;
  }, [entities]);

  const hasNorth = useMemo(
    () => entities.some((entity) => isNorthArrowEntity(entity) && entity.status !== "rejected"),
    [entities],
  );

  const rows = OVERLAY_VISIBILITY_GROUPS.filter((group) =>
    group.id === "ocr" ? hasOcr : counts[group.id] > 0,
  );

  return (
    <ul className="space-y-0.5 px-0.5">
      <li className="space-y-0.5">
        <div className="flex items-center gap-0.5">
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-[13px] text-slate-700 hover:bg-slate-50">
            <input
              type="checkbox"
              className="accent-slate-900"
              checked={showPageImage}
              onChange={toggleShowPageImage}
            />
            <span className="inline-block h-2 w-2 shrink-0 rounded-sm bg-slate-400" />
            <span className="min-w-0 flex-1 truncate">Page</span>
            <span className="tabular-nums text-slate-400">{Math.round(pageImageOpacity * 100)}</span>
          </label>
          <HoverHint text="Sheet raster. Uncheck to review overlays only." label="About page" />
        </div>
        <div className="flex items-center gap-1.5 px-1.5 pb-1">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            disabled={!showPageImage}
            value={Math.round(pageImageOpacity * 100)}
            onChange={(e) => setPageImageOpacity(Number(e.target.value) / 100)}
            className="h-1 min-w-0 flex-1 accent-slate-700 disabled:opacity-40"
            title="Page opacity"
            aria-label="Page opacity"
          />
        </div>
      </li>
      {rows.length === 0 ? (
        <li className="px-1.5 text-xs leading-snug text-slate-400">No overlays on this page</li>
      ) : null}
      {rows.map((group) => {
        const checked = group.id === "ocr" ? showOcrText : groupVisible[group.id];
        const count = group.id === "ocr" ? null : counts[group.id];
        return (
          <li key={group.id} className={group.id === "ocr" ? "space-y-0.5" : undefined}>
            <div className="flex items-center gap-0.5">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-[13px] text-slate-700 hover:bg-slate-50">
                <input
                  type="checkbox"
                  className="accent-slate-900"
                  checked={checked}
                  onChange={() =>
                    group.id === "ocr" ? toggleShowOcrText() : toggleOverlayGroup(group.id)
                  }
                />
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-sm"
                  style={{ background: SWATCH[group.id] }}
                />
                <span className="min-w-0 flex-1 truncate">{group.label}</span>
                {group.id === "ocr" ? (
                  <span className="tabular-nums text-slate-400">{ocrFontSize}</span>
                ) : count != null ? (
                  <span className="tabular-nums text-slate-400">{count}</span>
                ) : null}
              </label>
              <HoverHint text={group.hint} label={`About ${group.label}`} />
            </div>
            {group.id === "ocr" ? (
              <div className="flex items-center gap-1.5 px-1.5 pb-1">
                <input
                  type="range"
                  min={OCR_OVERLAY_FONT_MIN}
                  max={OCR_OVERLAY_FONT_MAX}
                  step={1}
                  disabled={!showOcrText}
                  value={ocrFontSize}
                  onChange={(e) => setOcrFontSize(Number(e.target.value))}
                  className="h-1 min-w-0 flex-1 accent-indigo-600 disabled:opacity-40"
                  title="OCR text size"
                  aria-label="OCR text size"
                />
              </div>
            ) : null}
          </li>
        );
      })}
      {hasNorth ? <CompassKeypointToggles /> : null}
    </ul>
  );
}
