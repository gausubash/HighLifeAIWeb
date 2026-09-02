"use client";

import { HoverHint } from "@/components/ui/HoverHint";
import { useViewerStore } from "@/features/plan-viewer/useViewerStore";
import {
  OVERLAY_VISIBILITY_GROUPS,
  type OverlayVisibilityGroup,
} from "./overlayVisibility";
import { useOverlayStore } from "./useOverlayStore";

const SWATCH: Record<OverlayVisibilityGroup, string> = {
  layout: "#0f766e",
  ocr: "#4f46e5",
  walls: "#ca8a04",
  rooms: "#2563eb",
  objects: "#ea580c",
  units: "#a855f7",
};

export function OverlayVisibilityToggles({
  includeOcr = true,
  compact = false,
}: {
  includeOcr?: boolean;
  compact?: boolean;
}) {
  const groupVisible = useOverlayStore((s) => s.groupVisible);
  const toggleOverlayGroup = useOverlayStore((s) => s.toggleOverlayGroup);
  const showOcrText = useViewerStore((s) => s.showOcrText);
  const toggleShowOcrText = useViewerStore((s) => s.toggleShowOcrText);
  const showPageImage = useViewerStore((s) => s.showPageImage);
  const toggleShowPageImage = useViewerStore((s) => s.toggleShowPageImage);
  const pageImageOpacity = useViewerStore((s) => s.pageImageOpacity);
  const setPageImageOpacity = useViewerStore((s) => s.setPageImageOpacity);

  const groups = includeOcr
    ? OVERLAY_VISIBILITY_GROUPS
    : OVERLAY_VISIBILITY_GROUPS.filter((g) => g.id !== "ocr");

  if (compact) {
    return (
      <div className="flex flex-wrap gap-x-2 gap-y-1">
        <label className="flex items-center gap-1 text-[13px] text-slate-700">
          <input
            type="checkbox"
            className="accent-slate-900"
            checked={showPageImage}
            onChange={toggleShowPageImage}
          />
          <span className="inline-block h-2 w-2 shrink-0 rounded-sm bg-slate-400" />
          Page
        </label>
        {groups.map((group) => {
          const checked = group.id === "ocr" ? showOcrText : groupVisible[group.id];
          const onChange =
            group.id === "ocr" ? toggleShowOcrText : () => toggleOverlayGroup(group.id);
          return (
            <label key={group.id} className="flex items-center gap-1 text-[13px] text-slate-700">
              <input type="checkbox" className="accent-slate-900" checked={checked} onChange={onChange} />
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-sm"
                style={{ background: SWATCH[group.id] }}
              />
              {group.label}
            </label>
          );
        })}
      </div>
    );
  }

  return (
    <ul className="space-y-0.5">
      <li>
        <div className="flex items-center gap-0.5">
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
            <input type="checkbox" checked={showPageImage} onChange={toggleShowPageImage} />
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm bg-slate-400" />
            <span className="min-w-0 flex-1 truncate font-medium">Page</span>
            <span className="tabular-nums text-slate-400">{Math.round(pageImageOpacity * 100)}</span>
          </label>
          <HoverHint text="Sheet raster. Uncheck for overlays only." label="About page" />
        </div>
        <div className="px-1.5 pb-1">
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            disabled={!showPageImage}
            value={Math.round(pageImageOpacity * 100)}
            onChange={(e) => setPageImageOpacity(Number(e.target.value) / 100)}
            className="h-1 w-full accent-slate-700 disabled:opacity-40"
            aria-label="Page opacity"
          />
        </div>
      </li>
      {groups.map((group) => {
        const checked = group.id === "ocr" ? showOcrText : groupVisible[group.id];
        const onChange =
          group.id === "ocr" ? toggleShowOcrText : () => toggleOverlayGroup(group.id);
        return (
          <li key={group.id}>
            <div className="flex items-center gap-0.5">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
                <input type="checkbox" checked={checked} onChange={onChange} />
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: SWATCH[group.id] }}
                />
                <span className="min-w-0 flex-1 truncate font-medium">{group.label}</span>
              </label>
              <HoverHint text={group.hint} label={`About ${group.label}`} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
