"use client";

import { useMemo } from "react";
import { classSwatch } from "./styles";
import { isLayoutEntity } from "./layoutRegionClasses";
import { useActiveOverlayPage, useOverlayStore } from "./useOverlayStore";

export function OverlayLayerPanel({
  sourceFilter = "all",
  excludeLayout = true,
}: {
  sourceFilter?: "model" | "all";
  /** Exclude sheet layout regions (title block, drawing area, etc.) from detections list. */
  excludeLayout?: boolean;
}) {
  const { entities } = useActiveOverlayPage();
  const hiddenLabels = useOverlayStore((s) => s.hiddenLabels);
  const toggleLabelVisibility = useOverlayStore((s) => s.toggleLabelVisibility);

  const rows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entity of entities) {
      if (sourceFilter === "model" && entity.source !== "model") continue;
      if (excludeLayout && isLayoutEntity(entity)) continue;
      const label = entity.label || entity.type;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [entities, sourceFilter, excludeLayout]);

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Detections</h3>
      {rows.length === 0 ? (
        <p className="text-xs leading-relaxed text-slate-500">
          No detections on this page. Run <span className="font-medium text-slate-700">Detect regions</span>{" "}
          to overlay walls and fixtures. Training labels stay in Model Studio.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map(([label, count]) => {
            const visible = !hiddenLabels[label];
            return (
              <li key={label}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={visible}
                    onChange={() => toggleLabelVisibility(label)}
                  />
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ background: classSwatch(label) }}
                  />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  <span className="tabular-nums text-slate-400">{count}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
