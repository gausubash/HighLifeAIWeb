"use client";

import { useEffect, useState } from "react";
import {
  fetchDetectModels,
  type DetectModelOption,
} from "@/lib/api/floorPlanClient";

const STORAGE_KEY = "highlife-detect-model";

export function readStoredDetectModel(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function writeStoredDetectModel(id: string): void {
  localStorage.setItem(STORAGE_KEY, id);
}

interface DetectModelSelectProps {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  className?: string;
  graphicsKind?: "vector" | "raster" | "hybrid" | "image" | "unknown";
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
  graphicsKind,
}: DetectModelSelectProps) {
  const [models, setModels] = useState<DetectModelOption[]>([]);
  const [defaultId, setDefaultId] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchDetectModels();
        if (cancelled) return;
        const vectorCapable = graphicsKind === "vector" || graphicsKind === "hybrid";
        const nextModels = [
          ...res.models,
          ...(vectorCapable
            ? [
                {
                  id: "wall:vector_pdf",
                  name: "PDF vector walls",
                  kind: "builtin" as const,
                  task: "segment",
                  description: "Use vector CAD strokes from the original uploaded PDF as wall candidates.",
                  ready: true,
                  runnable: true,
                  active: false,
                },
              ]
            : []),
        ];
        setModels(nextModels);
        setDefaultId(res.default);
        const stored = readStoredDetectModel();
        const pick =
          stored && nextModels.some((m) => m.id === stored && m.runnable)
            ? stored
            : res.default;
        if (!value || !nextModels.some((m) => m.id === value)) {
          onChange(pick);
        }
      } catch (e) {
        if (!cancelled) {
          setLoadError(e instanceof Error ? e.message : "Could not load models");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [graphicsKind, onChange, value]);

  const builtins = models.filter((m) => m.kind === "builtin" || m.kind === "stack");
  const studio = models.filter((m) => m.kind === "studio");

  return (
    <div className={className}>
      <label className="block text-xs font-medium text-slate-600">
        Detection model
        <select
          className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
          value={value}
          disabled={disabled || models.length === 0}
          onChange={(e) => {
            writeStoredDetectModel(e.target.value);
            onChange(e.target.value);
          }}
        >
          {models.length === 0 ? (
            <option value="">{loadError ?? "Loading models…"}</option>
          ) : (
            <>
              {builtins.length > 0 ? (
                <optgroup label="Built-in wall detectors">
                  {builtins.map((model) => (
                    <option
                      key={model.id}
                      value={model.id}
                      disabled={!model.runnable}
                    >
                      {optionLabel(model)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {studio.length > 0 ? (
                <optgroup label="Model Studio fine-tunes">
                  {studio.map((model) => (
                    <option
                      key={model.id}
                      value={model.id}
                      disabled={!model.runnable}
                    >
                      {optionLabel(model)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </>
          )}
        </select>
      </label>
      {value && models.length > 0 ? (
        <p className="mt-1 text-[10px] leading-relaxed text-slate-500">
          {models.find((m) => m.id === value)?.description ??
            (value === defaultId ? "Server default" : "")}
        </p>
      ) : null}
      {loadError ? (
        <p className="mt-1 text-[10px] text-red-600">{loadError}</p>
      ) : null}
    </div>
  );
}
