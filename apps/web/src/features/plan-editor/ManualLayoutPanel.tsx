"use client";

import { useMemo, useState } from "react";
import { clsx } from "clsx";
import type { PlanEntityType } from "@highlife/shared-types";
import {
  findDrawingAreaRegion,
  findLayoutRegion,
  findTitleBlockRegion,
} from "@/lib/scale/layoutRegionCrop";
import {
  DEFAULT_LAYOUT_ZONE_TYPES,
  layoutKindForZoneName,
  layoutRegionLabel,
  normalizeZoneName,
  type LayoutRegionKind,
} from "./layoutRegionClasses";
import { buildLayoutZoneRows } from "./layoutZoneRows";
import { geometryBBox } from "./types";
import { pageKey, useOverlayStore } from "./useOverlayStore";

type DetectScope = "page" | "all";

type ZoneRow = {
  key: string;
  type: LayoutRegionKind;
  label: string;
  optional: boolean;
  entityId?: string;
};

type ManualLayoutPanelProps = {
  analysisId: string;
  pageNumber: number;
  pageWidthPx: number;
  pageHeightPx: number;
  pageCount?: number;
  disabled?: boolean;
  detectBusy?: boolean;
  detectLabel?: string | null;
  detectProgress?: { index: number; total: number } | null;
  detectError?: string | null;
  detectWarning?: string | null;
  onAutoLayout?: (scope: DetectScope) => void;
  onCancelDetect?: () => void;
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
  entityId?: string,
  type?: PlanEntityType,
  label?: string,
) {
  const key = pageKey(analysisId, pageNumber);
  const slice = useOverlayStore.getState().pages[key];
  if (entityId) {
    const entity = slice?.entities.find((e) => e.id === entityId);
    if (entity) {
      useOverlayStore.getState().execute({ type: "remove", entities: [entity] });
    }
    return;
  }
  const name = label ? normalizeZoneName(label) : "";
  const toRemove = (slice?.entities ?? []).filter((e) => {
    if (e.type !== type || e.source !== "manual" || e.status === "rejected") return false;
    if (type === "notes" && name) return normalizeZoneName(e.label) === name;
    return true;
  });
  if (toRemove.length > 0) {
    useOverlayStore.getState().execute({ type: "remove", entities: toRemove });
  }
}

function entityRegionStatus(entity: { geometry: import("./types").OverlayGeometry; confidence: number }) {
  const bbox = geometryBBox(entity.geometry);
  return {
    widthPx: Math.round(Math.abs(bbox.width)),
    heightPx: Math.round(Math.abs(bbox.height)),
    confidence: entity.confidence,
  };
}

function shortStatus(
  region: { widthPx: number; heightPx: number; confidence: number } | null,
  manual: boolean,
) {
  if (!region) return "—";
  const src = manual ? "manual" : region.confidence < 1 ? "auto" : "set";
  return `${region.widthPx}×${region.heightPx} · ${src}`;
}

export function ManualLayoutPanel({
  analysisId,
  pageNumber,
  pageWidthPx,
  pageHeightPx,
  pageCount = 1,
  disabled = false,
  detectBusy,
  detectLabel,
  detectProgress,
  detectError,
  detectWarning,
  onAutoLayout,
  onCancelDetect,
}: ManualLayoutPanelProps) {
  const layoutDrawType = useOverlayStore((s) => s.layoutDrawType);
  const layoutDrawLabel = useOverlayStore((s) => s.layoutDrawLabel);
  const setLayoutDrawType = useOverlayStore((s) => s.setLayoutDrawType);
  const select = useOverlayStore((s) => s.select);
  const pageSlice = useOverlayStore((s) => s.pages[pageKey(analysisId, pageNumber)]);
  const entities = pageSlice?.entities ?? [];
  const selectedIds = pageSlice?.selectedIds ?? [];
  const [scope, setScope] = useState<DetectScope>("page");
  const [extraZones, setExtraZones] = useState<ZoneRow[]>([]);
  const [newZoneName, setNewZoneName] = useState("");

  const visibleZones = useMemo(
    () => buildLayoutZoneRows(entities, extraZones) as ZoneRow[],
    [entities, extraZones],
  );

  const addZone = () => {
    const label = newZoneName.trim();
    if (!label) return;
    const type = layoutKindForZoneName(label);
    if (DEFAULT_LAYOUT_ZONE_TYPES.includes(type)) {
      setLayoutDrawType(type, layoutRegionLabel(type));
      setNewZoneName("");
      return;
    }
    setExtraZones((prev) => {
      const name = normalizeZoneName(label);
      if (prev.some((z) => z.type === type && normalizeZoneName(z.label) === name)) return prev;
      return [...prev, { type, label, optional: true }];
    });
    setLayoutDrawType(type, label);
    setNewZoneName("");
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          {detectBusy ? (
            <button
              type="button"
              className="btn-compact-secondary"
              onClick={() => onCancelDetect?.()}
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="btn-compact-primary"
              disabled={disabled || !onAutoLayout}
              onClick={() => onAutoLayout?.(scope)}
            >
              Auto layout
            </button>
          )}
          <label className="flex items-center gap-1 text-[13px] text-slate-700">
            <input
              type="checkbox"
              className="accent-slate-900"
              checked={scope === "page"}
              disabled={detectBusy}
              onChange={() => setScope("page")}
            />
            Page
          </label>
          <label className="flex items-center gap-1 text-[13px] text-slate-700">
            <input
              type="checkbox"
              className="accent-slate-900"
              checked={scope === "all"}
              disabled={detectBusy || pageCount < 1}
              onChange={() => setScope("all")}
            />
            All{pageCount > 1 ? ` ${pageCount}` : ""}
          </label>
        </div>
        {detectBusy && detectProgress && detectProgress.total > 0 ? (
          <div className="space-y-0.5">
            <div className="h-1 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-brand-600 transition-all"
                style={{
                  width: `${(100 * detectProgress.index) / Math.max(1, detectProgress.total)}%`,
                }}
              />
            </div>
            {detectLabel ? (
              <p className="text-xs leading-snug text-slate-500">{detectLabel}</p>
            ) : null}
          </div>
        ) : detectBusy && detectLabel ? (
          <p className="text-xs leading-snug text-slate-500">{detectLabel}</p>
        ) : null}
        {detectError ? (
          <p className="text-xs leading-snug text-red-600">{detectError}</p>
        ) : detectWarning ? (
          <p className="text-xs leading-snug text-amber-700">{detectWarning}</p>
        ) : null}
      </div>

      <div className="space-y-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Zones
          </p>
          {layoutDrawType ? (
            <p className="truncate text-xs text-amber-800">
              Draw {layoutRegionLabel(layoutDrawType, layoutDrawLabel ?? undefined)} · Esc
            </p>
          ) : null}
        </div>
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
          {visibleZones.map((item) => {
            const match = item.entityId
              ? entities.find((e) => e.id === item.entityId && e.status !== "rejected")
              : entities.find((e) => {
                  if (e.status === "rejected") return false;
                  if (item.type === "notes") {
                    return e.type === "notes" && normalizeZoneName(e.label) === normalizeZoneName(item.label);
                  }
                  return e.type === item.type;
                });
            const region =
              match || item.type === "notes"
                ? null
                : regionForType(analysisId, pageNumber, pageWidthPx, pageHeightPx, item.type);
            const customMatch = match ? entityRegionStatus(match) : region;
            const manual = match?.source === "manual";
            const drawing =
              layoutDrawType === item.type &&
              (item.type !== "notes" ||
                normalizeZoneName(layoutDrawLabel ?? "") === normalizeZoneName(item.label));
            const selected = Boolean(match && selectedIds.includes(match.id));
            const canRemove = Boolean(item.entityId || manual || item.optional);
            return (
              <li key={item.key}>
                <div
                  className={clsx(
                    "flex items-center gap-1 px-1.5 py-1",
                    selected && "bg-teal-50",
                  )}
                >
                  <button
                    type="button"
                    disabled={disabled || !match}
                    className="min-w-0 flex-1 text-left disabled:cursor-default"
                    onClick={() => match && select([match.id])}
                  >
                    <p className="truncate text-[13px] font-medium text-slate-800">{item.label}</p>
                    <p className="truncate text-xs tabular-nums text-slate-500">
                      {shortStatus(customMatch, Boolean(manual))}
                    </p>
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    className={clsx(
                      "h-5 shrink-0 rounded px-1.5 text-xs font-medium",
                      drawing
                        ? "bg-slate-900 text-white"
                        : "border border-slate-300 text-slate-700 hover:bg-slate-50",
                    )}
                    onClick={() =>
                      setLayoutDrawType(drawing ? null : item.type, drawing ? null : item.label)
                    }
                  >
                    {drawing ? "…" : "Draw"}
                  </button>
                  {canRemove ? (
                    <button
                      type="button"
                      disabled={disabled}
                      className="h-5 shrink-0 rounded px-1 text-xs text-slate-500 hover:text-red-700"
                      title={`Remove ${item.label}`}
                      onClick={() => {
                        if (item.entityId || manual) {
                          clearManualLayoutRegion(
                            analysisId,
                            pageNumber,
                            item.entityId,
                            item.type,
                            item.label,
                          );
                        }
                        if (item.optional && !item.entityId) {
                          setExtraZones((prev) =>
                            prev.filter(
                              (z) =>
                                !(
                                  z.type === item.type &&
                                  normalizeZoneName(z.label) === normalizeZoneName(item.label)
                                ),
                            ),
                          );
                        }
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            addZone();
          }}
        >
          <input
            type="text"
            aria-label="New zone name"
            placeholder="Add zone… Legend, Revision, Key plan"
            className="h-6 min-w-0 flex-1 rounded border border-dashed border-slate-300 bg-white px-1.5 text-[13px] text-slate-700 placeholder:text-slate-400"
            value={newZoneName}
            disabled={disabled}
            onChange={(e) => setNewZoneName(e.target.value)}
          />
          <button
            type="submit"
            disabled={disabled || !newZoneName.trim()}
            className="h-6 shrink-0 rounded border border-slate-300 px-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            Add
          </button>
        </form>
      </div>
    </div>
  );
}
