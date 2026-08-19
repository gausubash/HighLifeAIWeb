"use client";

import type { AnalysisResult } from "@highlife/shared-types";
import { VIEWER_LAYERS } from "@highlife/shared-types";
import { useViewerStore } from "./useViewerStore";

interface LayerControlsProps {
  result: AnalysisResult;
}

export function LayerControls({ result }: LayerControlsProps) {
  const { visibleLayers, toggleLayer } = useViewerStore();

  const layerCounts: Partial<Record<string, number>> = {
    rooms: result.spaces.filter((s) => s.spaceType === "room").length,
    commonCorridor: result.spaces.filter((s) => s.spaceType === "common_corridor").length,
    balconies: result.spaces.filter((s) => s.spaceType === "balcony").length,
    unitBoundaries: result.units.length,
    unitEntrances: result.openings.filter((o) => o.openingType === "unit_entrance").length,
    uncertain: result.spaces.filter((s) => s.reviewRequired).length + result.units.filter((u) => u.reviewRequired).length,
  };

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-700">Layers</h3>
      <ul className="space-y-1">
        {VIEWER_LAYERS.map(({ id, label }) => {
          const count = layerCounts[id];
          const disabled = count === 0;
          return (
            <li key={id}>
              <label
                className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50 ${disabled ? "opacity-40" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={visibleLayers[id]}
                  onChange={() => toggleLayer(id)}
                  disabled={disabled}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="flex-1">{label}</span>
                {count != null && count > 0 && (
                  <span className="text-xs text-slate-400">{count}</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
