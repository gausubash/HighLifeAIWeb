"use client";

import { formatLayoutRegionSummary, findLayoutRegion } from "@/lib/scale/layoutRegionCrop";
import { entityAreaHint } from "./geometry";
import {
  LAYOUT_REGION_TYPES,
  isLayoutRegionType,
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
    (e) => selectedIds.includes(e.id) && isLayoutRegionType(e.type) && e.status !== "rejected",
  );

  if (!entity) {
    return (
      <div className="space-y-2 rounded border border-slate-200 px-3 py-2">
        <p className="text-[11px] font-medium text-slate-700">Edit layout region</p>
        <p className="text-[11px] leading-relaxed text-slate-500">
          Use <strong>Select</strong> in the toolbar, then click a title block or drawing area box
          on the plan. Drag inside to move, drag corners to resize.
        </p>
      </div>
    );
  }

  const rect = layoutEntityToRect(entity);
  const info = findLayoutRegion(analysisId, pageNumber, pageWidthPx, pageHeightPx, entity.type);
  const measure = entityAreaHint(rect);

  return (
    <div className="space-y-2 rounded border border-teal-200 bg-teal-50/40 px-3 py-2">
      <p className="text-[11px] font-medium text-slate-800">Edit layout region</p>
      <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-600">
        Region type
        <select
          className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-normal text-slate-800"
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
      </label>
      {measure ? <p className="text-[11px] text-slate-600">{measure}</p> : null}
      {info ? (
        <p className="text-[10px] leading-snug text-teal-900">
          Active for OCR: {formatLayoutRegionSummary(info)}
          {entity.source === "manual" ? " · manual" : " · detected"}
        </p>
      ) : null}
      <p className="text-[10px] text-slate-500">
        {entity.source === "model"
          ? `${Math.round(entity.confidence * 100)}% detected — edits are saved as manual adjustments.`
          : "Drawn manually."}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-medium text-slate-800 hover:bg-slate-50"
          onClick={() => {
            const normalized = layoutEntityToRect(entity);
            if (normalized.geometry.kind !== entity.geometry.kind) {
              execute({ type: "update", id: entity.id, before: entity, after: normalized });
            }
            select([entity.id]);
          }}
        >
          Fit to box
        </button>
        <button
          type="button"
          className="flex-1 rounded border border-red-200 bg-white px-2 py-1.5 text-[11px] font-medium text-red-700 hover:bg-red-50"
          onClick={() => deleteSelected()}
        >
          Remove
        </button>
      </div>
    </div>
  );
}
