"use client";

import type { AnalysisResult } from "@highlife/shared-types";
import { useViewerStore } from "@/features/plan-viewer/useViewerStore";
import { formatArea, formatConfidence } from "@/lib/utils";

interface UnitSidebarProps {
  result: AnalysisResult;
}

export function UnitSidebar({ result }: UnitSidebarProps) {
  const { selectedId, selectObject } = useViewerStore();

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Units</h3>
        <ul className="space-y-2">
          {result.unitSummaries.map((unit) => (
            <li key={unit.unitId}>
              <button
                type="button"
                onClick={() => selectObject(unit.unitId)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                  selectedId === unit.unitId
                    ? "border-brand-500 bg-brand-50"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{unit.unitId}</span>
                  {unit.reviewStatus === "review_required" && (
                    <span className="badge bg-amber-100 text-amber-800">Review</span>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  {formatArea(unit.areaM2)} · {unit.roomCount} rooms ·{" "}
                  {formatConfidence(unit.confidence)}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {result.reviewWarnings.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Review warnings</h3>
          <ul className="space-y-2">
            {result.reviewWarnings.map((w, i) => (
              <li
                key={`${w.code}-${i}`}
                className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              >
                {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
