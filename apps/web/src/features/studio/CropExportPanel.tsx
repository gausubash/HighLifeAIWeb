"use client";

import { useEffect, useMemo, useState } from "react";
import { HeadingHint } from "@/components/ui/HoverHint";

function preferredClasses(classNames: string[]): string[] {
  const north = classNames.find((name) => /north/i.test(name));
  if (north) return [north];
  return classNames.slice(0, 1);
}

export function CropExportPanel({
  classNames,
  selectedCount = 0,
  defaultName,
  busy = false,
  error = null,
  notice = null,
  onExportClass,
  onExportSelected,
}: {
  classNames: string[];
  selectedCount?: number;
  defaultName?: string;
  busy?: boolean;
  error?: string | null;
  notice?: string | null;
  onExportClass: (opts: {
    classLabels: string[];
    targetName: string;
    paddingFrac: number;
    square: boolean;
  }) => void;
  onExportSelected?: (opts: { targetName: string; paddingFrac: number; square: boolean }) => void;
}) {
  const classes = useMemo(
    () => (classNames.length ? classNames : ["North Arrow"]),
    [classNames],
  );
  const [picked, setPicked] = useState<string[]>(() => preferredClasses(classes));
  const [name, setName] = useState(defaultName ?? "");
  const [paddingPct, setPaddingPct] = useState(25);
  const [square, setSquare] = useState(true);

  useEffect(() => {
    setPicked((current) => {
      const keep = current.filter((label) => classes.includes(label));
      return keep.length ? keep : preferredClasses(classes);
    });
  }, [classes]);

  const toggle = (label: string) => {
    setPicked((current) =>
      current.includes(label) ? current.filter((item) => item !== label) : [...current, label],
    );
  };

  const paddingFrac = Math.max(0, paddingPct) / 100;
  const allOn = classes.length > 0 && picked.length === classes.length;

  return (
    <section className="space-y-2 rounded border border-slate-200 bg-slate-50/70 p-3">
      <HeadingHint
        title="Crop labels to a new dataset"
        className="text-xs font-semibold text-slate-800"
        hint="Fine-tune specialists (north arrow, doors) on tight crops — not full sheets. Only pages that already have the selected labels are used."
      />
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Classes to crop
            {picked.length ? (
              <span className="ml-1 font-normal tabular-nums text-slate-500">
                {picked.length}/{classes.length}
              </span>
            ) : null}
          </p>
          <div className="btn-segment-group">
            <button
              type="button"
              className="btn-segment px-1.5"
              disabled={busy || allOn}
              onClick={() => setPicked([...classes])}
            >
              All
            </button>
            <button
              type="button"
              className="btn-segment px-1.5"
              disabled={busy || picked.length === 0}
              onClick={() => setPicked([])}
            >
              None
            </button>
          </div>
        </div>
        <ul className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {classes.map((label) => {
            const on = picked.includes(label);
            return (
              <li key={label}>
                <label
                  className={
                    on
                      ? "flex cursor-pointer items-center gap-1 rounded border border-slate-800 bg-slate-900 px-1.5 py-0.5 text-[13px] text-white"
                      : "flex cursor-pointer items-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[13px] text-slate-700 hover:border-slate-400"
                  }
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={on}
                    onChange={() => toggle(label)}
                  />
                  {label}
                </label>
              </li>
            );
          })}
        </ul>
      </div>
      <label className="block text-[13px] text-slate-600">
        New dataset name
        <input
          className="mt-0.5 h-7 w-full rounded border border-slate-300 bg-white px-1.5 text-[13px] text-slate-800"
          value={name}
          placeholder={defaultName || "North arrow crops"}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1 text-[13px] text-slate-600">
          Padding
          <input
            type="number"
            min={0}
            max={100}
            className="h-7 w-14 rounded border border-slate-300 bg-white px-1 text-[13px] tabular-nums"
            value={paddingPct}
            onChange={(e) => setPaddingPct(Number(e.target.value))}
          />
          %
        </label>
        <label className="flex items-center gap-1 text-[13px] text-slate-600">
          <input
            type="checkbox"
            className="accent-slate-900"
            checked={square}
            onChange={(e) => setSquare(e.target.checked)}
          />
          Square crop
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-compact-primary"
          disabled={busy || picked.length === 0}
          onClick={() =>
            onExportClass({
              classLabels: picked,
              targetName: name.trim(),
              paddingFrac,
              square,
            })
          }
        >
          {busy
            ? "Cropping…"
            : picked.length === 1
              ? `Crop all ${picked[0]}`
              : `Crop ${picked.length} classes`}
        </button>
        {onExportSelected ? (
          <button
            type="button"
            className="btn-compact-secondary"
            disabled={busy || selectedCount === 0}
            title={
              selectedCount === 0
                ? "Select one or more overlays on the page first"
                : `Crop ${selectedCount} selected overlay${selectedCount === 1 ? "" : "s"}`
            }
            onClick={() =>
              onExportSelected({
                targetName: name.trim(),
                paddingFrac,
                square,
              })
            }
          >
            Crop selected ({selectedCount})
          </button>
        ) : null}
      </div>
      {notice ? <p className="text-[13px] text-teal-800">{notice}</p> : null}
      {error ? <p className="text-[13px] text-red-600">{error}</p> : null}
    </section>
  );
}
