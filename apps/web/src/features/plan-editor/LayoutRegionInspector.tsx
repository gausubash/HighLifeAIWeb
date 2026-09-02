"use client";

import { findLayoutRegion } from "@/lib/scale/layoutRegionCrop";
import { entityAreaHint } from "./geometry";
import {
  LAYOUT_REGION_TYPES,
  isLayoutEntity,
  layoutRegionLabel,
  type LayoutRegionKind,
} from "./layoutRegionClasses";
import { useActiveOverlayPage, useOverlayStore } from "./useOverlayStore";
import { layoutEntityToRect } from "./layoutRegionGeometry";

export function LayoutRegionInspector({
  analysisId,
  pageNumber,
  pageWidthPx,
  pageHeightPx,
}: {
  analysisId: string;
  pageNumber: number;
  pageWidthPx: number;
  pageHeightPx: number;
}) {
  const { entities, selectedIds } = useActiveOverlayPage();
  const updateSelected = useOverlayStore((s) => s.updateSelected);
  const deleteSelected = useOverlayStore((s) => s.deleteSelected);
  const execute = useOverlayStore((s) => s.execute);
  const select = useOverlayStore((s) => s.select);

  const entity = entities.find(
    (e) => selectedIds.includes(e.id) && isLayoutEntity(e) && e.status !== "rejected",
  );

  if (!entity) return null;

  const rect = layoutEntityToRect(entity);
  const info = findLayoutRegion(analysisId, pageNumber, pageWidthPx, pageHeightPx, entity.type);
  const measure = entityAreaHint(rect);
  const src = entity.source === "manual" ? "manual" : "auto";
  const custom = entity.type === "notes" || !LAYOUT_REGION_TYPES.some((item) => item.type === entity.type);

  return (
    <div className="space-y-1.5 rounded-md border border-teal-200 bg-teal-50/50 px-2 py-1.5">
      <div className="flex items-center gap-1">
        {custom ? (
          <input
            aria-label="Zone name"
            className="h-6 min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 text-[13px] text-slate-800"
            defaultValue={entity.label}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (!next || next === entity.label) return;
              updateSelected({
                label: next,
                attributes: { ...entity.attributes, layoutRegion: true, zoneName: next },
              });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
        ) : (
          <select
            aria-label="Region type"
            className="h-6 min-w-0 flex-1 rounded border border-slate-300 bg-white px-1 text-[13px] text-slate-800"
            value={entity.type}
            onChange={(e) => {
              const next = e.target.value as LayoutRegionKind;
              updateSelected({
                type: next,
                label: layoutRegionLabel(next),
                attributes: { ...entity.attributes, layoutRegion: true, layoutKind: next },
              });
            }}
          >
            {LAYOUT_REGION_TYPES.map((item) => (
              <option key={item.type} value={item.type}>
                {item.label}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="h-6 shrink-0 rounded border border-slate-300 bg-white px-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          onClick={() => {
            const normalized = layoutEntityToRect(entity);
            if (normalized.geometry.kind !== entity.geometry.kind) {
              execute({ type: "update", id: entity.id, before: entity, after: normalized });
            }
            select([entity.id]);
          }}
        >
          Fit
        </button>
        <button
          type="button"
          className="h-6 shrink-0 rounded border border-red-200 bg-white px-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
          onClick={() => deleteSelected()}
        >
          Remove
        </button>
      </div>
      <p className="text-xs tabular-nums leading-snug text-slate-600">
        {[measure, src, info ? `${Math.round(info.areaFrac * 100)}%` : null]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </div>
  );
}
