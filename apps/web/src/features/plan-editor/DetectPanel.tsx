"use client";

import { useState } from "react";
import { HoverHint } from "@/components/ui/HoverHint";
import { COMPASS_KEYPOINT_SWATCH } from "@/lib/hierarchy/compassKeypoints";
import { CompassBearingReadout } from "./CompassBearingReadout";
import { CompassKeypointToggles } from "./CompassKeypointToggles";
import { DetectModelSelect, DEFAULT_DETECT_MODEL_BY_PERSIST_KEY } from "./DetectModelSelect";
import { detectActionLabel, type DetectTask } from "./detectTask";
import { EntityInspector } from "./EntityInspector";
import { NORTH_CROP_OPTIONS } from "./northCropScope";
import { OverlayLayerPanel } from "./OverlayLayerPanel";
import {
  DETECT_IMGSZ_OPTIONS,
  useDetectModelSettingsStore,
  type DetectFamily,
} from "./useDetectModelSettingsStore";
import { useOverlayStore } from "./useOverlayStore";

type DetectPanelProps = {
  modelId: string;
  onChangeModel: (id: string, model?: { category?: string | null }) => void;
  detecting?: boolean;
  detectTask: DetectTask;
  autoDetect: boolean;
  onAutoDetectChange: (enabled: boolean) => void;
  onRun: () => void;
  onRunModel?: (modelId: string, category?: string | null) => void;
  onRunAll?: () => void;
  familyCounts?: { walls: number; rooms: number; openings: number; objects: number; north: number; structural: number };
  onCancel: () => void;
  progress?: { index: number; total: number; label: string } | null;
  detectError?: string | null;
  detectWarning?: string | null;
  regionCount: number;
  modelLabel?: string | null;
  onInferUnits: () => void;
  unitInferNotice?: string | null;
  inferDisabled?: boolean;
  onPolicy: () => void;
  onCancelPolicy: () => void;
  policyBusy?: boolean;
  policyError?: string | null;
  policyCount?: number;
  onOpenReview?: () => void;
};

export function DetectPanel({
  modelId,
  onChangeModel,
  detecting,
  detectTask,
  autoDetect,
  onAutoDetectChange,
  onRun,
  onRunModel,
  onRunAll,
  familyCounts,
  onCancel,
  progress,
  detectError,
  detectWarning,
  regionCount,
  modelLabel,
  onInferUnits,
  unitInferNotice,
  inferDisabled,
  onPolicy,
  onCancelPolicy,
  policyBusy,
  policyError,
  policyCount = 0,
  onOpenReview,
}: DetectPanelProps) {
  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((100 * progress.index) / Math.max(1, progress.total)))
      : 0;

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          {detecting ? (
            <button
              type="button"
              className="btn-compact-secondary"
              onClick={onCancel}
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="btn-compact-primary"
              title="Sliding-window detect each specialist, then stitch"
              onClick={() => (onRunAll ? onRunAll() : onRun())}
            >
              Run all
            </button>
          )}
          <label className="flex items-center gap-1 text-[13px] text-slate-700">
            <input
              type="checkbox"
              className="accent-slate-900"
              checked={autoDetect}
              disabled={detecting}
              onChange={(e) => onAutoDetectChange(e.target.checked)}
            />
            Auto
          </label>
          {regionCount > 0 ? (
            <span className="ml-auto truncate text-xs tabular-nums text-slate-500">
              {regionCount} · {modelLabel ?? detectActionLabel(detectTask)}
            </span>
          ) : null}
          <HoverHint
            text="Seven specialists (layout, walls, structural, rooms/units, openings, north, OCR) plus a VLM on the graph. Each card tiles and stitches on its own; studio models swap in by family."
            label="About detect"
          />
        </div>
        {detecting && progress && progress.total > 0 ? (
          <div className="space-y-0.5">
            <div className="h-1 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-brand-600 transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-xs leading-snug text-slate-500">{progress.label}</p>
          </div>
        ) : detecting ? (
          <p className="text-xs leading-snug text-slate-500">{progress?.label ?? "Detecting…"}</p>
        ) : null}
        {detectError ? (
          <p className="text-xs leading-snug text-red-600">{detectError}</p>
        ) : detectWarning && !detecting ? (
          <p
            className={`text-xs leading-snug ${
              regionCount === 0 ? "text-amber-700" : "text-slate-500"
            }`}
          >
            {detectWarning}
          </p>
        ) : null}
        <DetectFamilyCard
          family="walls"
          title="Walls"
          category="wall_segmentation"
          persistKey="highlife-detect-model-walls"
          modelId={modelId}
          onChangeModel={onChangeModel}
          detecting={Boolean(detecting)}
          count={familyCounts?.walls}
          onRun={() => (onRunModel ? onRunModel(modelId, "wall_segmentation") : onRun())}
        />
        <DetectFamilyCard
          family="structural"
          title="Structural"
          category="structural_detection"
          persistKey="highlife-detect-model-structural"
          detecting={Boolean(detecting)}
          count={familyCounts?.structural}
          onRunModel={onRunModel}
        />
        <DetectFamilyCard
          family="rooms"
          title="Rooms"
          category="room_types"
          persistKey="highlife-detect-model-rooms"
          detecting={Boolean(detecting)}
          count={familyCounts?.rooms}
          onRunModel={onRunModel}
        />
        <DetectFamilyCard
          family="openings"
          title="Openings"
          category="opening_detection"
          persistKey="highlife-detect-model-openings"
          detecting={Boolean(detecting)}
          count={familyCounts?.openings}
          onRunModel={onRunModel}
        />
        <DetectFamilyCard
          family="objects"
          title="Fixtures"
          category="object_detection"
          persistKey="highlife-detect-model-objects"
          detecting={Boolean(detecting)}
          count={familyCounts?.objects}
          onRunModel={onRunModel}
        />
        <DetectFamilyCard
          family="north"
          title="North"
          category="north_arrow"
          persistKey="highlife-detect-model-north"
          detecting={Boolean(detecting)}
          count={familyCounts?.north}
          onRunModel={onRunModel}
        />
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <span className="w-12 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Units
          </span>
          <button
            type="button"
            className="h-6 rounded border border-slate-300 px-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            disabled={inferDisabled || detecting}
            onClick={onInferUnits}
          >
            Infer
          </button>
        </div>
        {unitInferNotice ? (
          <p className="pl-[3.25rem] text-xs leading-snug text-slate-500">{unitInferNotice}</p>
        ) : null}
        <div className="flex items-center gap-1">
          <span className="w-12 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Policy
          </span>
          {policyBusy ? (
            <button
              type="button"
              className="h-6 rounded border border-slate-300 px-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              onClick={onCancelPolicy}
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="h-6 rounded border border-slate-300 px-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              disabled={detecting}
              onClick={onPolicy}
            >
              Check
            </button>
          )}
          {policyCount > 0 && onOpenReview ? (
            <button
              type="button"
              className="truncate text-xs text-brand-700 hover:underline"
              onClick={onOpenReview}
            >
              {policyCount} result{policyCount === 1 ? "" : "s"}
            </button>
          ) : null}
        </div>
        {policyError ? (
          <p className="pl-[3.25rem] text-xs leading-snug text-red-600">{policyError}</p>
        ) : null}
      </div>

      <OverlayLayerPanel sourceFilter="model" compact />
      <EntityInspector sourceFilter="model" compact />
    </div>
  );
}

function DetectFamilyCard({
  family,
  title,
  category,
  persistKey,
  detecting,
  count,
  modelId,
  onChangeModel,
  onRun,
  onRunModel,
}: {
  family: DetectFamily;
  title: string;
  category: string;
  persistKey: string;
  detecting: boolean;
  count?: number;
  modelId?: string;
  onChangeModel?: (id: string, model?: { category?: string | null }) => void;
  onRun?: () => void;
  onRunModel?: (modelId: string, category?: string | null) => void;
}) {
  const [localId, setLocalId] = useState(
    () => modelId ?? DEFAULT_DETECT_MODEL_BY_PERSIST_KEY[persistKey] ?? "",
  );
  const value = modelId ?? localId;
  const run = () => {
    if (onRun) onRun();
    else if (onRunModel && value) onRunModel(value, category);
  };

  return (
    <div className="space-y-1.5 rounded border border-slate-200 bg-white px-1.5 py-1.5">
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
          {title}
        </span>
        {count != null && count > 0 ? (
          <span className="text-xs tabular-nums text-slate-500">{count}</span>
        ) : null}
        <button
          type="button"
          className="h-6 rounded border border-slate-300 px-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          disabled={detecting || !value}
          onClick={run}
        >
          Run
        </button>
      </div>
      <DetectModelSelect
        compact
        hideModelLabel
        value={value}
        persistKey={persistKey}
        categoryFilter={category}
        disabled={detecting}
        onChange={(id, model) => {
          setLocalId(id);
          onChangeModel?.(id, model);
        }}
      />
      <PatchSettings family={family} disabled={detecting} />
      {family === "north" ? (
        <>
          <NorthCropScopeControls disabled={detecting} />
          <CompassKeypointToggles compact />
          <NorthManualBearing />
        </>
      ) : null}
    </div>
  );
}

function NorthManualBearing() {
  const compassPlace = useOverlayStore((s) => s.compassPlace);
  const setCompassPlace = useOverlayStore((s) => s.setCompassPlace);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <span className="w-12 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Manual
        </span>
        <div className="btn-segment-group min-w-0 flex-1">
          {(["tip", "base"] as const).map((name) => (
            <button
              key={name}
              type="button"
              title={name === "tip" ? "Place compass tip (T)" : "Place compass base (B)"}
              className={
                compassPlace === name
                  ? "btn-segment inline-flex min-w-0 flex-1 items-center justify-center gap-1 bg-slate-100 font-medium"
                  : "btn-segment inline-flex min-w-0 flex-1 items-center justify-center gap-1"
              }
              onClick={() => setCompassPlace(compassPlace === name ? null : name)}
            >
              <span
                className={
                  name === "tip"
                    ? "inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    : "inline-block h-1.5 w-1.5 shrink-0 rounded-sm"
                }
                style={{ background: COMPASS_KEYPOINT_SWATCH[name] }}
              />
              <span className="capitalize">{name}</span>
              <span className="text-xs text-slate-400">{name === "tip" ? "T" : "B"}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="pl-[3.25rem]">
        <CompassBearingReadout compact />
      </div>
    </div>
  );
}

function NorthCropScopeControls({ disabled }: { disabled: boolean }) {
  const northCrop = useDetectModelSettingsStore((s) => s.northCrop);
  const setNorthCrop = useDetectModelSettingsStore((s) => s.setNorthCrop);
  const selected = NORTH_CROP_OPTIONS.find((opt) => opt.id === northCrop) ?? NORTH_CROP_OPTIONS[0];

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <span className="flex w-12 shrink-0 items-center gap-0.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Search
          <HoverHint text={selected.hint} label="About search area" align="start" />
        </span>
        <div className="btn-segment-group min-w-0 flex-1">
          {NORTH_CROP_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              title={opt.hint}
              className={
                northCrop === opt.id
                  ? "btn-segment min-w-0 flex-1 bg-slate-100 font-medium"
                  : "btn-segment min-w-0 flex-1"
              }
              onClick={() => setNorthCrop(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PatchSettings({
  family,
  disabled,
}: {
  family: DetectFamily;
  disabled: boolean;
}) {
  const tileEnabled = useDetectModelSettingsStore((s) => s.families[family]?.tileEnabled ?? true);
  const imgsz = useDetectModelSettingsStore((s) => s.families[family]?.imgsz ?? 640);
  const threshold = useDetectModelSettingsStore((s) => s.families[family]?.threshold ?? 0.25);
  const overlap = useDetectModelSettingsStore((s) => s.families[family]?.overlap ?? 0.2);
  const setTileEnabled = useDetectModelSettingsStore((s) => s.setTileEnabled);
  const setImgsz = useDetectModelSettingsStore((s) => s.setImgsz);
  const setThreshold = useDetectModelSettingsStore((s) => s.setThreshold);
  const setOverlap = useDetectModelSettingsStore((s) => s.setOverlap);
  const resetDefaults = useDetectModelSettingsStore((s) => s.resetDefaults);

  return (
    <div className="space-y-1.5 rounded border border-slate-200 bg-slate-50/80 px-1.5 py-1.5">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-[13px] text-slate-700">
          <input
            type="checkbox"
            className="accent-slate-900"
            checked={tileEnabled}
            disabled={disabled}
            onChange={(e) => setTileEnabled(family, e.target.checked)}
          />
          Tile
          <HoverHint
            align="start"
            label="About tiling"
            text={
              tileEnabled
                ? "Tiles the page at this size when it is larger than the window. Turn off to letterbox the whole page once."
                : "Single pass at this size. Fine for small crops; large pages lose thin walls."
            }
          />
        </label>
        <button
          type="button"
          className="ml-auto text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
          disabled={disabled}
          onClick={() => resetDefaults(family)}
        >
          Reset
        </button>
      </div>
      <div className="flex items-center gap-1">
        <span className="w-12 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Size
        </span>
        <select
          className="h-6 min-w-0 flex-1 rounded border border-slate-300 bg-white px-1 text-xs text-slate-800"
          disabled={disabled}
          value={imgsz}
          onChange={(e) => setImgsz(family, Number(e.target.value))}
        >
          {DETECT_IMGSZ_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label} px
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-1">
        <span className="w-12 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Conf
        </span>
        <input
          type="range"
          min={0.15}
          max={0.85}
          step={0.05}
          disabled={disabled}
          className="min-w-0 flex-1 accent-slate-900"
          value={threshold}
          onChange={(e) => setThreshold(family, Number(e.target.value))}
        />
        <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-500">
          {threshold.toFixed(2)}
        </span>
      </label>
      {tileEnabled ? (
        <label className="flex items-center gap-1">
          <span className="w-12 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Overlap
          </span>
          <input
            type="range"
            min={0}
            max={40}
            step={5}
            disabled={disabled}
            className="min-w-0 flex-1 accent-slate-900"
            value={Math.round(overlap * 100)}
            onChange={(e) => setOverlap(family, Number(e.target.value) / 100)}
          />
          <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-500">
            {Math.round(overlap * 100)}%
          </span>
        </label>
      ) : null}
    </div>
  );
}
