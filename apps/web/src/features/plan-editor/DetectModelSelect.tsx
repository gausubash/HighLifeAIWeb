"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchDetectModels,
  type DetectModelOption,
} from "@/lib/api/floorPlanClient";
import { prefetchInferenceBackend } from "@/lib/api/inferenceClient";
import { HoverHint } from "@/components/ui/HoverHint";
import { categoryLabel } from "@/lib/studio/categories";

const STORAGE_KEY = "highlife-detect-model";
const LOAD_RETRIES = 4;
const LOAD_RETRY_MS = 1500;

/** Built-in default per Detect card (persist key → catalog token). */
export const DEFAULT_DETECT_MODEL_BY_PERSIST_KEY: Record<string, string> = {
  "highlife-detect-model-walls": "wall:mitunet",
  "highlife-detect-model-rooms": "room:architect",
  "highlife-detect-model-openings": "opening:architect",
  "highlife-detect-model-structural": "structural:roboflow-seg",
  "highlife-detect-model-objects": "object:architect",
  "highlife-detect-model-north": "symbol:north",
};

const GROUP_ORDER = ["wall_segmentation", "structural_detection", "room_types", "opening_detection", "object_detection", "north_arrow"] as const;

export function readStoredDetectModel(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function writeStoredDetectModel(id: string): void {
  localStorage.setItem(STORAGE_KEY, id);
}

function normalizeStoredDetectToken(stored: string | null, persistKey: string): string | null {
  if (!stored) return stored;
  if (
    persistKey === "highlife-detect-model-structural" &&
    (stored === "wall:roboflow-seg" || stored === "opening:roboflow-seg")
  ) {
    return "structural:roboflow-seg";
  }
  return stored;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchDetectModelsWithRetry(signal?: AbortSignal): Promise<Awaited<ReturnType<typeof fetchDetectModels>>> {
  let lastError: unknown;
  for (let attempt = 0; attempt < LOAD_RETRIES; attempt += 1) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      if (attempt === 0) {
        await prefetchInferenceBackend();
      }
      return await fetchDetectModels(signal);
    } catch (err) {
      lastError = err;
      if (attempt < LOAD_RETRIES - 1) {
        await sleep(LOAD_RETRY_MS * (attempt + 1));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not load models");
}

interface DetectModelSelectProps {
  value: string;
  onChange: (id: string, model?: DetectModelOption) => void;
  disabled?: boolean;
  className?: string;
  compact?: boolean;
  /** Only show this catalog category (one Detect card). */
  categoryFilter?: string;
  persistKey?: string;
  hideModelLabel?: boolean;
}

function optionLabel(model: DetectModelOption): string {
  const parts = [model.name];
  if (!model.ready) parts.push("(weights missing)");
  else if (!model.runnable) parts.push("(not wired yet)");
  if (model.active) parts.push("· active");
  return parts.join(" ");
}

export function DetectModelSelect({
  value,
  onChange,
  disabled = false,
  className,
  compact = false,
  categoryFilter,
  persistKey = STORAGE_KEY,
  hideModelLabel = false,
}: DetectModelSelectProps) {
  const [models, setModels] = useState<DetectModelOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);
  onChangeRef.current = onChange;
  valueRef.current = value;

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;

    void (async () => {
      try {
        setLoadError(null);
        const res = await fetchDetectModelsWithRetry(ctrl.signal);
        if (cancelled) return;

        const nextModels = res.models
          .filter((m) => m.kind !== "layout")
          .filter((m) => !categoryFilter || (m.category || "") === categoryFilter);
        setModels(nextModels);

        const storedRaw =
          persistKey === STORAGE_KEY
            ? readStoredDetectModel()
            : typeof window !== "undefined"
              ? localStorage.getItem(persistKey)
              : null;
        const stored = normalizeStoredDetectToken(storedRaw, persistKey ?? "");
        const categoryDefault = DEFAULT_DETECT_MODEL_BY_PERSIST_KEY[persistKey ?? ""] ?? "";
        const currentValue = valueRef.current;
        const pick =
          stored && nextModels.some((m) => m.id === stored && m.runnable)
            ? stored
            : nextModels.find((m) => m.id === categoryDefault && m.runnable)?.id ||
              nextModels.find((m) => m.id === res.default && m.runnable)?.id ||
              nextModels.find((m) => m.runnable)?.id ||
              categoryDefault ||
              "";

        if (!currentValue || !nextModels.some((m) => m.id === currentValue)) {
          const selected = nextModels.find((m) => m.id === pick);
          onChangeRef.current(pick, selected);
          if (pick && persistKey !== STORAGE_KEY && typeof window !== "undefined") {
            localStorage.setItem(persistKey, pick);
          }
        }
      } catch (e) {
        if (cancelled || ctrl.signal.aborted) return;
        const msg = e instanceof Error ? e.message : "Could not load models";
        setLoadError(
          msg === "Failed to fetch"
            ? "Model list still loading — Run works with saved defaults."
            : msg,
        );
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [categoryFilter, persistKey]);

  const groups = useMemo(() => {
    const byCat = new Map<string, DetectModelOption[]>();
    for (const model of models) {
      const cat = model.category || "object_detection";
      const list = byCat.get(cat) ?? [];
      list.push(model);
      byCat.set(cat, list);
    }
    const ordered: { id: string; label: string; items: DetectModelOption[] }[] = [];
    for (const id of GROUP_ORDER) {
      const items = byCat.get(id);
      if (items?.length) ordered.push({ id, label: categoryLabel(id), items });
    }
    for (const [id, items] of byCat) {
      if (GROUP_ORDER.includes(id as (typeof GROUP_ORDER)[number])) continue;
      ordered.push({ id, label: categoryLabel(id), items });
    }
    return ordered;
  }, [models]);

  const selected = models.find((m) => m.id === value);
  const singleBuiltin =
    categoryFilter && models.length === 1 ? models[0] : null;
  const showError = loadError && models.length === 0;

  const selectEl =
    singleBuiltin && singleBuiltin.runnable ? (
      <div
        className={
          compact
            ? "flex h-6 min-w-0 w-full items-center rounded border border-slate-200 bg-slate-50 px-1.5 text-[13px] text-slate-700"
            : "mt-1 flex items-center rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700"
        }
        title={singleBuiltin.description}
      >
        <span className="min-w-0 flex-1 truncate">{singleBuiltin.name}</span>
        {!singleBuiltin.ready ? (
          <span className="ml-1 shrink-0 text-xs text-amber-700">weights missing</span>
        ) : null}
      </div>
    ) : (
    <select
      aria-label="Detection model"
      className={
        compact
          ? "h-6 min-w-0 w-full rounded border border-slate-300 bg-white px-1 text-[13px] text-slate-800 disabled:opacity-50"
          : "mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
      }
      value={value}
      disabled={disabled || models.length === 0}
      onChange={(e) => {
        if (persistKey === STORAGE_KEY) writeStoredDetectModel(e.target.value);
        else localStorage.setItem(persistKey, e.target.value);
        const model = models.find((m) => m.id === e.target.value);
        onChange(e.target.value, model);
      }}
    >
      {models.length === 0 ? (
        <option value={value || ""}>{loadError ? "Using saved model" : "Loading models…"}</option>
      ) : (
        groups.map((group) => (
          <optgroup key={group.id} label={group.label}>
            {group.items.map((model) => (
              <option key={model.id} value={model.id} disabled={!model.runnable}>
                {optionLabel(model)}
              </option>
            ))}
          </optgroup>
        ))
      )}
    </select>
    );

  if (compact) {
    return (
      <div className={className}>
        <div className="flex items-center gap-1">
          {hideModelLabel ? null : (
            <span className="w-12 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Model
            </span>
          )}
          {selectEl}
        </div>
        {showError ? <p className="mt-0.5 text-xs text-amber-700">{loadError}</p> : null}
      </div>
    );
  }

  return (
    <div className={className}>
      <label className="block text-xs font-medium text-slate-600">
        <span className="flex items-center gap-1">
          Detection model
          {selected ? <HoverHint text={selected.description} label="About this model" align="start" /> : null}
        </span>
        {selectEl}
      </label>
      {showError ? (
        <p className="mt-1 text-xs text-amber-700">{loadError}</p>
      ) : null}
    </div>
  );
}
