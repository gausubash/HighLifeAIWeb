"use client";

import { useActiveOverlayPage, useOverlayStore } from "./useOverlayStore";
import { classSwatch } from "./styles";
import { entityAreaHint } from "./geometry";

export function EntityInspector() {
  const { entities, selectedIds } = useActiveOverlayPage();
  const deleteSelected = useOverlayStore((s) => s.deleteSelected);
  const entity = entities.find((e) => e.id === selectedIds[0]);

  if (selectedIds.length > 1) {
    return (
      <div className="text-xs text-slate-600">
        {selectedIds.length} regions selected.
        <button
          type="button"
          className="mt-2 block w-full rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50"
          onClick={() => deleteSelected()}
        >
          Remove selected
        </button>
      </div>
    );
  }

  if (!entity) {
    return (
      <p className="text-xs leading-relaxed text-slate-500">
        Click a coloured region on the plan to see its class and confidence.
      </p>
    );
  }

  const measure = entityAreaHint(entity);

  return (
    <div className="space-y-2 text-xs">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected</h3>
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-3 w-3 rounded-sm"
          style={{ background: classSwatch(entity.label) }}
        />
        <span className="text-sm font-medium text-slate-800">{entity.label}</span>
      </div>
      <p className="text-slate-600">{Math.round(entity.confidence * 100)}% confidence</p>
      {measure ? <p className="text-slate-500">{measure}</p> : null}
      <button
        type="button"
        className="w-full rounded border border-red-200 px-2 py-1 text-red-700 hover:bg-red-50"
        onClick={() => deleteSelected()}
      >
        Remove
      </button>
    </div>
  );
}
