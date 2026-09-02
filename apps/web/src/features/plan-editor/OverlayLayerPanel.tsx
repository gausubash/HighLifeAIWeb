"use client";

import { useMemo } from "react";
import { classSwatch } from "./styles";
import { isLayoutEntity } from "./layoutRegionClasses";
import { labelIsHidden } from "./overlayVisibility";
import { useActiveOverlayPage, useOverlayStore } from "./useOverlayStore";
import { useGeometryExtractStore } from "@/features/analyses/useGeometryExtractStore";

export function OverlayLayerPanel({
  sourceFilter = "all",
  excludeLayout = true,
  compact = false,
}: {
  sourceFilter?: "model" | "all";
  excludeLayout?: boolean;
  compact?: boolean;
}) {
  const { entities } = useActiveOverlayPage();
  const hiddenLabels = useOverlayStore((s) => s.hiddenLabels);
  const toggleLabelVisibility = useOverlayStore((s) => s.toggleLabelVisibility);
  const removeByLabel = useOverlayStore((s) => s.removeByLabel);
  const removeGeometryByLabel = useGeometryExtractStore((s) => s.removeByLabel);

  const rows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entity of entities) {
      if (entity.status === "rejected") continue;
      if (sourceFilter === "model" && entity.source !== "model" && entity.source !== "inferred") continue;
      if (excludeLayout && isLayoutEntity(entity)) continue;
      const label = entity.label || entity.type;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [entities, sourceFilter, excludeLayout]);

  return (
    <div className={compact ? "space-y-1" : "space-y-3"}>
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Classes{rows.length ? ` · ${rows.reduce((n, [, c]) => n + c, 0)}` : ""}
        </p>
        {rows.length === 0 ? (
          <p className="text-xs leading-snug text-slate-400">No detections on this page</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
            {rows.map(([label, count]) => {
              const visible = !labelIsHidden(hiddenLabels, label);
              return (
                <li key={label} className="flex items-center gap-0.5 pr-1">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-1.5 py-1 text-[13px] text-slate-700">
                    <input
                      type="checkbox"
                      className="accent-slate-900"
                      checked={visible}
                      onChange={() => toggleLabelVisibility(label)}
                    />
                    <span
                      className="inline-block h-2 w-2 rounded-sm"
                      style={{ background: classSwatch(label) }}
                    />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    <span className="tabular-nums text-slate-400">{count}</span>
                  </label>
                  <button
                    type="button"
                    className="h-5 shrink-0 rounded px-1 text-xs text-red-600 hover:bg-red-50"
                    title={`Remove all ${label}`}
                    aria-label={`Remove all ${label}`}
                    onClick={() => {
                      removeByLabel(label);
                      removeGeometryByLabel(label);
                    }}
                  >
                    Del
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
