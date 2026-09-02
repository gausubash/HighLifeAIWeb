"use client";

import { useMemo, useRef, useState } from "react";
import { classSwatch } from "./styles";
import { LABELME_CLASSES } from "./labelClasses";
import { LAYOUT_LABELME_CLASSES } from "./layoutLabelClasses";
import { HeadingHint } from "@/components/ui/HoverHint";
import { CompassKeypointToggles } from "./CompassKeypointToggles";
import { EntityInspector } from "./EntityInspector";
import { useActiveOverlayPage, useOverlayStore } from "./useOverlayStore";
import type { AnnotateSaveStatus } from "@/features/studio/studioLabelSave";

interface AnnotationPanelProps {
  onImportFile: (file: File) => void;
  onExport: () => void;
  onSave?: () => void;
  saveStatus?: AnnotateSaveStatus;
  saveError?: string | null;
  importError?: string | null;
  /** Show sheet layout classes (title block, drawing area, legend, …). */
  includeLayoutClasses?: boolean;
  /** Dataset-specific classes beyond the built-in list. */
  extraClasses?: string[];
  onAddClass?: (name: string) => void | Promise<void>;
  addClassError?: string | null;
  compassAnnotate?: boolean;
}

function LegendRows({
  classes,
  labelClass,
  counts,
  hiddenLabels,
  setLabelClass,
  toggleLabelVisibility,
}: {
  classes: readonly string[];
  labelClass: string;
  counts: Map<string, number>;
  hiddenLabels: Record<string, boolean>;
  setLabelClass: (name: string) => void;
  toggleLabelVisibility: (name: string) => void;
}) {
  return (
    <>
      {classes.map((name) => {
        const active = labelClass === name;
        const count = counts.get(name) ?? 0;
        const visible = !hiddenLabels[name];
        return (
          <li key={name} className="flex items-center border-b border-slate-100 last:border-b-0">
            <button
              type="button"
              title={visible ? `Hide ${name}` : `Show ${name}`}
              className="px-1.5 py-1 text-slate-400 hover:text-slate-700"
              onClick={() => toggleLabelVisibility(name)}
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{
                  background: visible ? classSwatch(name) : "transparent",
                  outline: `1px solid ${classSwatch(name)}`,
                }}
              />
            </button>
            <button
              type="button"
              className={
                active
                  ? "flex min-w-0 flex-1 items-center justify-between gap-2 bg-slate-900 px-2 py-1 text-left text-xs text-white"
                  : "flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-50"
              }
              onClick={() => setLabelClass(name)}
            >
              <span className="truncate">{name}</span>
              <span className={active ? "tabular-nums text-slate-300" : "tabular-nums text-slate-400"}>
                {count}
              </span>
            </button>
          </li>
        );
      })}
    </>
  );
}

function AddClassForm({
  onAdd,
  error,
}: {
  onAdd?: (name: string) => void | Promise<void>;
  error?: string | null;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  if (!onAdd) return null;

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onAdd(trimmed);
      setValue("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-1">
        <input
          type="text"
          value={value}
          placeholder="New class name"
          disabled={busy}
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-800"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
        />
        <button
          type="button"
          className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          disabled={busy || !value.trim()}
          onClick={() => void submit()}
        >
          Add
        </button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

export function AnnotationPanel({
  onImportFile,
  onExport,
  onSave,
  saveStatus = "idle",
  saveError,
  importError,
  includeLayoutClasses = false,
  extraClasses = [],
  onAddClass,
  addClassError,
  compassAnnotate = false,
}: AnnotationPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { entities, selectedIds } = useActiveOverlayPage();
  const labelClass = useOverlayStore((s) => s.labelClass);
  const setLabelClass = useOverlayStore((s) => s.setLabelClass);
  const select = useOverlayStore((s) => s.select);
  const deleteSelected = useOverlayStore((s) => s.deleteSelected);
  const clearPageLabels = useOverlayStore((s) => s.clearPageLabels);
  const hiddenLabels = useOverlayStore((s) => s.hiddenLabels);
  const toggleLabelVisibility = useOverlayStore((s) => s.toggleLabelVisibility);

  const humanCount = useMemo(
    () => entities.filter((entity) => entity.source !== "model").length,
    [entities],
  );

  const counts = useMemo(() => {
    const next = new Map<string, number>();
    for (const entity of entities) {
      next.set(entity.label, (next.get(entity.label) ?? 0) + 1);
    }
    return next;
  }, [entities]);

  const shapes = useMemo(
    () =>
      entities.map((entity, index) => ({
        id: entity.id,
        n: index + 1,
        label: entity.label,
        source: entity.source,
      })),
    [entities],
  );

  const roomClasses = useMemo(() => {
    const merged = [...LABELME_CLASSES, ...extraClasses];
    const seen = new Set(merged);
    for (const entity of entities) {
      if (!seen.has(entity.label)) {
        seen.add(entity.label);
        merged.push(entity.label);
      }
    }
    return merged;
  }, [entities, extraClasses]);

  const classOptionsForInspector = roomClasses;

  return (
    <div className="space-y-4">
      {compassAnnotate ? (
        <div className="space-y-1.5">
          <HeadingHint
            title="Compass keypoints"
            className="text-xs font-semibold uppercase tracking-wide text-slate-500"
            hint="Draw the compass, then place tip and base (T / B). Drag a keypoint to move it. Wait for Saved or press Ctrl+S — tip and base live on the north-arrow JSON, not only on screen."
          />
          <CompassKeypointToggles compact />
        </div>
      ) : null}

      <div>
        {includeLayoutClasses ? (
          <>
            <HeadingHint
              title="Sheet layout"
              className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              hint="Draw a Drawing area rectangle so tile generation crops to the floor plan, or rely on layout detect."
            />
            <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-slate-200">
              <LegendRows
                classes={LAYOUT_LABELME_CLASSES}
                labelClass={labelClass}
                counts={counts}
                hiddenLabels={hiddenLabels}
                setLabelClass={setLabelClass}
                toggleLabelVisibility={toggleLabelVisibility}
              />
            </ul>
            <HeadingHint
              title="Rooms & elements"
              className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500"
              hint="Pick a class from the legend, then draw. Labels save on this PC next to the page PNG."
            />
            <ul className="mt-1 max-h-56 overflow-y-auto rounded border border-slate-200">
              <LegendRows
                classes={roomClasses}
                labelClass={labelClass}
                counts={counts}
                hiddenLabels={hiddenLabels}
                setLabelClass={setLabelClass}
                toggleLabelVisibility={toggleLabelVisibility}
              />
            </ul>
            <AddClassForm onAdd={onAddClass} error={addClassError} />
          </>
        ) : (
          <>
            <HeadingHint
              title="Legend"
              className="text-xs font-semibold uppercase tracking-wide text-slate-500"
              hint="Pick a class from the legend, then draw. Labels save on this PC next to the page PNG."
            />
            <ul className="mt-1 max-h-56 overflow-y-auto rounded border border-slate-200">
              <LegendRows
                classes={roomClasses}
                labelClass={labelClass}
                counts={counts}
                hiddenLabels={hiddenLabels}
                setLabelClass={setLabelClass}
                toggleLabelVisibility={toggleLabelVisibility}
              />
            </ul>
            <AddClassForm onAdd={onAddClass} error={addClassError} />
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {onSave ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="flex-1 rounded bg-brand-700 px-2 py-1.5 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50"
              disabled={saveStatus === "saving" || saveStatus === "saved" || saveStatus === "idle"}
              onClick={onSave}
            >
              {saveStatus === "saving"
                ? "Saving…"
                : saveStatus === "saved"
                  ? "Saved"
                  : saveStatus === "error"
                    ? "Retry save"
                    : "Save labels"}
            </button>
            <span
              className={
                saveStatus === "error"
                  ? "text-xs text-red-600"
                  : saveStatus === "unsaved"
                    ? "text-xs text-amber-700"
                    : "text-xs text-slate-500"
              }
            >
              {saveStatus === "unsaved"
                ? "Unsaved"
                : saveStatus === "saving"
                  ? "Writing JSON…"
                  : saveStatus === "saved"
                    ? "On this PC"
                    : saveStatus === "error"
                      ? saveError || "Save failed"
                      : "Ctrl+S"}
            </span>
          </div>
        ) : null}
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onImportFile(file);
            }}
          />
          <button
            type="button"
            className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={() => fileRef.current?.click()}
          >
            Import JSON
          </button>
          <button
            type="button"
            className="flex-1 rounded border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            onClick={onExport}
          >
            Export JSON
          </button>
        </div>
        {humanCount > 0 ? (
          <button
            type="button"
            className="w-full rounded border border-red-200 px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
            onClick={() => {
              if (
                !window.confirm(
                  `Clear all ${humanCount} label${humanCount === 1 ? "" : "s"} on this page? The LabelMe JSON for this page will be removed on save.`,
                )
              ) {
                return;
              }
              clearPageLabels();
            }}
          >
            Clear all labels / JSON
          </button>
        ) : null}
      </div>
      {importError ? <p className="text-[13px] text-red-600">{importError}</p> : null}

      <div>
        <HeadingHint
          title={`Shapes (${shapes.length})`}
          className="text-xs font-semibold uppercase tracking-wide text-slate-500"
          hint="Import a LabelMe file or start drawing. Click a shape to select it."
        />
        {shapes.length === 0 ? (
          <p className="mt-1 text-[13px] text-slate-400">No shapes on this page</p>
        ) : (
          <ul className="mt-1 max-h-44 overflow-y-auto rounded border border-slate-200">
            {shapes.map((shape) => {
              const selected = selectedIds.includes(shape.id);
              return (
                <li key={shape.id}>
                  <button
                    type="button"
                    className={
                      selected
                        ? "flex w-full items-center gap-2 bg-slate-100 px-2 py-1 text-left text-xs text-slate-900"
                        : "flex w-full items-center gap-2 px-2 py-1 text-left text-xs text-slate-700 hover:bg-slate-50"
                    }
                    onClick={() => select([shape.id])}
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ background: classSwatch(shape.label) }}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {shape.n}. {shape.label}
                    </span>
                    {shape.source !== "model" ? (
                      <span className="text-xs uppercase tracking-wide text-slate-400">
                        {shape.source === "labelme" ? "json" : "draw"}
                      </span>
                    ) : (
                      <span className="text-xs uppercase tracking-wide text-slate-400">detect</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {selectedIds.length > 0 ? (
          <button
            type="button"
            className="mt-2 w-full rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
            onClick={() => deleteSelected()}
          >
            Delete selected
          </button>
        ) : null}
      </div>

      <EntityInspector classOptions={classOptionsForInspector} />
    </div>
  );
}
