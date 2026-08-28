"use client";

import { entityTypeForLabel, isKnownAnnotateClass, LABELME_CLASSES, roomTypeFor } from "./labelClasses";
import { classSwatch } from "./styles";
import { entityAreaHint } from "./geometry";
import { isLayoutEntity } from "./layoutRegionClasses";
import { useActiveOverlayPage, useOverlayStore } from "./useOverlayStore";

export function EntityInspector({
  sourceFilter = "all",
  excludeLayout = true,
  classOptions,
}: {
  sourceFilter?: "model" | "all";
  excludeLayout?: boolean;
  classOptions?: string[];
}) {
  const { entities, selectedIds } = useActiveOverlayPage();
  const deleteSelected = useOverlayStore((s) => s.deleteSelected);
  const updateSelected = useOverlayStore((s) => s.updateSelected);
  const entity = entities.find((e) => {
    if (!selectedIds.includes(e.id)) return false;
    if (sourceFilter === "model" && e.source !== "model") return false;
    if (excludeLayout && isLayoutEntity(e)) return false;
    return true;
  });

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
        {sourceFilter === "model"
          ? "Select a detection to inspect it. Class colors are listed above."
          : "Select a region to change its class. Class colors are in the legend."}
      </p>
    );
  }

  const measure = entityAreaHint(entity);
  const options = classOptions ?? [...LABELME_CLASSES];
  const known = isKnownAnnotateClass(entity.label) || options.includes(entity.label);

  return (
    <div className="space-y-2 text-xs">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected</h3>
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-3 w-3 rounded-sm"
          style={{ background: classSwatch(entity.label) }}
        />
        <select
          className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-800"
          value={entity.label}
          onChange={(e) => {
            const next = e.target.value;
            updateSelected({
              label: next,
              type: entityTypeForLabel(next),
              attributes: { ...entity.attributes, roomType: roomTypeFor(next) },
            });
          }}
        >
          {!known ? <option value={entity.label}>{entity.label}</option> : null}
          {options.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <p className="text-slate-500">
        {entity.source === "model"
          ? `${Math.round(entity.confidence * 100)}% model · ${entity.status.replace(/_/g, " ")}`
          : entity.source === "labelme"
            ? "Imported LabelMe"
            : "Drawn"}
      </p>
      {measure ? <p className="text-slate-500">{measure}</p> : null}
      {entity.source === "model" ? (
        <div className="flex gap-2">
          <button
            type="button"
            className="flex-1 rounded border border-emerald-200 px-2 py-1 text-emerald-800 hover:bg-emerald-50"
            onClick={() => updateSelected({ status: "user_confirmed" })}
          >
            Keep
          </button>
          <button
            type="button"
            className="flex-1 rounded border border-amber-200 px-2 py-1 text-amber-800 hover:bg-amber-50"
            onClick={() => updateSelected({ status: "rejected" })}
          >
            Reject
          </button>
        </div>
      ) : null}
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
