"use client";

import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import type { ScaleToolMode } from "@/features/scale/ScalePanel";
import { LABELME_CLASSES } from "./labelClasses";
import { layoutRegionLabel } from "./layoutRegionClasses";
import {
  IconCalibrate,
  IconMarquee,
  IconMeasure,
  IconPan,
  IconPin,
  IconPoint,
  IconPolygon,
  IconPolyline,
  IconRect,
  IconRedo,
  IconRotateAllCcw,
  IconRotateAllCw,
  IconRotateCcw,
  IconRotateCw,
  IconSelect,
  IconTrash,
  IconUndo,
} from "./ToolbarIcons";
import type { OverlayTool } from "./types";
import { useLayoutStore } from "@/features/plan-viewer/useLayoutStore";
import { useOverlayStore } from "./useOverlayStore";

const VIEW_TOOLS: { id: OverlayTool; title: string; icon: ReactNode }[] = [
  { id: "pan", title: "Pan (Middle click / H)", icon: <IconPan /> },
  {
    id: "select",
    title: "Select (Right click / V) — Shift-click to add, drag for a box",
    icon: <IconSelect />,
  },
  { id: "marquee", title: "Marquee select (M)", icon: <IconMarquee /> },
];

const DRAW_TOOLS: { id: OverlayTool; title: string; icon: ReactNode }[] = [
  { id: "rect", title: "Rectangle (R)", icon: <IconRect /> },
  { id: "polyline", title: "Polyline", icon: <IconPolyline /> },
  { id: "polygon", title: "Polygon (P)", icon: <IconPolygon /> },
  { id: "point", title: "Point", icon: <IconPoint /> },
];

export interface EditorScaleTools {
  mode: ScaleToolMode;
  onModeChange: (mode: ScaleToolMode) => void;
  canMeasure?: boolean;
  measureLabel?: string | null;
  calibrateReady?: boolean;
  onApplyCalibration?: (realLength: number, unit: "m" | "mm") => void;
}

interface EditorToolbarProps {
  onDetect?: () => void;
  detecting?: boolean;
  detectError?: string | null;
  detectWarning?: string | null;
  regionCount?: number;
  modelLabel?: string | null;
  onRotateCw?: () => void;
  onRotateCcw?: () => void;
  onRotateAllCw?: () => void;
  onRotateAllCcw?: () => void;
  pageCount?: number;
  rotating?: boolean;
  rotateStatus?: string | null;
  showDrawTools?: boolean;
  /** Full class list for the draw-class dropdown (defaults to built-in). */
  classOptions?: string[];
  /** North-arrow datasets: Tip/Base placement instead of a generic point. */
  compassKeypoints?: boolean;
  scaleTools?: EditorScaleTools;
}

function ToolButton({
  title,
  active,
  disabled,
  danger,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm",
        disabled && "cursor-not-allowed opacity-35",
        active
          ? "bg-slate-900 text-white shadow-sm"
          : danger
            ? "text-red-600 hover:bg-red-50"
            : "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
      )}
    >
      {children}
    </button>
  );
}

function ToolDivider() {
  return <span className="mx-1.5 h-3.5 w-px shrink-0 bg-slate-200" aria-hidden />;
}

function CalibrateLengthForm({
  onApply,
}: {
  onApply: (realLength: number, unit: "m" | "mm") => void;
}) {
  const [length, setLength] = useState("");
  const [unit, setUnit] = useState<"m" | "mm">("m");
  const value = Number(length);
  const canApply = Number.isFinite(value) && value > 0;

  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canApply) return;
        onApply(value, unit);
      }}
    >
      <label className="sr-only" htmlFor="calibrate-known-length">
        Known length
      </label>
      <input
        id="calibrate-known-length"
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        placeholder="Length"
        className="h-6 w-16 rounded border border-slate-300 bg-white px-1 text-xs tabular-nums text-slate-800 placeholder:text-slate-400"
        value={length}
        onChange={(e) => setLength(e.target.value)}
      />
      <select
        aria-label="Length unit"
        className="h-6 rounded border border-slate-300 bg-white px-0.5 text-xs text-slate-800"
        value={unit}
        onChange={(e) => setUnit(e.target.value === "mm" ? "mm" : "m")}
      >
        <option value="m">m</option>
        <option value="mm">mm</option>
      </select>
      <button
        type="submit"
        disabled={!canApply}
        className="h-6 rounded bg-slate-900 px-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-40"
      >
        Apply
      </button>
    </form>
  );
}

export function EditorToolbar({
  onDetect,
  detecting = false,
  detectError = null,
  detectWarning = null,
  regionCount = 0,
  modelLabel = null,
  onRotateCw,
  onRotateCcw,
  onRotateAllCw,
  onRotateAllCcw,
  pageCount = 1,
  rotating = false,
  rotateStatus = null,
  showDrawTools = false,
  classOptions,
  compassKeypoints = false,
  scaleTools,
}: EditorToolbarProps) {
  const drawClasses = classOptions ?? [...LABELME_CLASSES];
  const tool = useOverlayStore((s) => s.tool);
  const setTool = useOverlayStore((s) => s.setTool);
  const layoutDrawType = useOverlayStore((s) => s.layoutDrawType);
  const layoutDrawLabel = useOverlayStore((s) => s.layoutDrawLabel);
  const labelClass = useOverlayStore((s) => s.labelClass);
  const setLabelClass = useOverlayStore((s) => s.setLabelClass);
  const compassPlace = useOverlayStore((s) => s.compassPlace);
  const setCompassPlace = useOverlayStore((s) => s.setCompassPlace);
  const draft = useOverlayStore((s) => s.draft);
  const undo = useOverlayStore((s) => s.undo);
  const redo = useOverlayStore((s) => s.redo);
  const deleteSelected = useOverlayStore((s) => s.deleteSelected);
  const pages = useOverlayStore((s) => s.pages);
  const analysisId = useOverlayStore((s) => s.analysisId);
  const pageNumber = useOverlayStore((s) => s.pageNumber);
  const slice = pages[`${analysisId}:${pageNumber}`];
  const canUndo = (slice?.past.length ?? 0) > 0;
  const canRedo = (slice?.future.length ?? 0) > 0;
  const selectedCount = slice?.selectedIds.length ?? 0;
  const drawing =
    draft &&
    (draft.tool === "polygon" || draft.tool === "polyline" || draft.tool === "mask");
  const scaleMode = scaleTools?.mode ?? "none";
  const scaleActive = scaleMode === "measure" || scaleMode === "calibrate";
  const toolbarPinned = useLayoutStore((s) => s.toolbarPinned);
  const toggleToolbarPinned = useLayoutStore((s) => s.toggleToolbarPinned);

  const pickOverlayTool = (id: OverlayTool) => {
    scaleTools?.onModeChange("none");
    setTool(id);
  };

  const pickScaleTool = (mode: "measure" | "calibrate") => {
    const next = scaleMode === mode ? "none" : mode;
    scaleTools?.onModeChange(next);
    if (next !== "none") setTool("select");
  };

  return (
    <div
      className="flex h-6 flex-nowrap items-center gap-1 overflow-x-auto px-2 py-0.5"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {onDetect ? (
        <>
          <button
            type="button"
            className="h-6 rounded bg-slate-900 px-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            disabled={detecting}
            onClick={() => onDetect()}
          >
            {detecting ? "Detecting…" : "Detect"}
          </button>
          <ToolDivider />
        </>
      ) : null}

      {VIEW_TOOLS.map((t) => (
        <ToolButton
          key={t.id}
          title={t.title}
          active={!scaleActive && tool === t.id}
          onClick={() => pickOverlayTool(t.id)}
        >
          {t.icon}
        </ToolButton>
      ))}

      {scaleTools ? (
        <>
          <ToolDivider />
          <ToolButton
            title="Measure a distance (L)"
            active={scaleMode === "measure"}
            disabled={scaleTools.canMeasure === false}
            onClick={() => pickScaleTool("measure")}
          >
            <IconMeasure />
          </ToolButton>
          <ToolButton
            title="Calibrate scale from two points on a known length (C)"
            active={scaleMode === "calibrate"}
            onClick={() => pickScaleTool("calibrate")}
          >
            <IconCalibrate />
          </ToolButton>
          {scaleMode === "calibrate" && scaleTools.calibrateReady && scaleTools.onApplyCalibration ? (
            <CalibrateLengthForm onApply={scaleTools.onApplyCalibration} />
          ) : null}
          {scaleMode === "measure" && scaleTools.measureLabel ? (
            <span className="px-1 text-[13px] font-medium tabular-nums text-sky-800">
              {scaleTools.measureLabel}
            </span>
          ) : null}
        </>
      ) : null}

      {showDrawTools ? (
        <>
          <ToolDivider />
          {(compassKeypoints ? DRAW_TOOLS.filter((t) => t.id !== "point") : DRAW_TOOLS).map((t) => (
            <ToolButton
              key={t.id}
              title={t.title}
              active={!scaleActive && tool === t.id && !compassPlace}
              onClick={() => pickOverlayTool(t.id)}
            >
              {t.icon}
            </ToolButton>
          ))}
          {compassKeypoints ? (
            <>
              <ToolButton
                title="Place compass tip (T)"
                active={!scaleActive && compassPlace === "tip"}
                onClick={() => setCompassPlace(compassPlace === "tip" ? null : "tip")}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-red-600" />
              </ToolButton>
              <ToolButton
                title="Place compass base (B)"
                active={!scaleActive && compassPlace === "base"}
                onClick={() => setCompassPlace(compassPlace === "base" ? null : "base")}
              >
                <span className="h-1.5 w-1.5 rounded-sm bg-blue-600" />
              </ToolButton>
            </>
          ) : null}
          <label className="ml-1 flex items-center gap-1 text-[13px] text-slate-500">
            <span className="sr-only">Class</span>
            <select
              title="Draw class"
              aria-label="Draw class"
              className="h-6 max-w-[9rem] rounded border border-slate-300 bg-white px-1 text-xs text-slate-800"
              value={drawClasses.includes(labelClass) ? labelClass : labelClass}
              onChange={(e) => setLabelClass(e.target.value)}
            >
              {!drawClasses.includes(labelClass) ? (
                <option value={labelClass}>{labelClass}</option>
              ) : null}
              {drawClasses.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}

      <ToolDivider />
      <ToolButton title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={() => undo()}>
        <IconUndo />
      </ToolButton>
      <ToolButton title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={() => redo()}>
        <IconRedo />
      </ToolButton>
      <ToolButton title="Delete selected" danger onClick={() => deleteSelected()}>
        <IconTrash />
      </ToolButton>
      {selectedCount > 0 ? (
        <span className="px-1 text-xs tabular-nums text-slate-500">{selectedCount}</span>
      ) : null}

      {onRotateCw || onRotateCcw ? (
        <>
          <ToolDivider />
          <ToolButton
            title="Rotate this page 90° counter-clockwise"
            disabled={rotating || !onRotateCcw}
            onClick={() => onRotateCcw?.()}
          >
            <IconRotateCcw />
          </ToolButton>
          <ToolButton
            title="Rotate this page 90° clockwise"
            disabled={rotating || !onRotateCw}
            onClick={() => onRotateCw?.()}
          >
            <IconRotateCw />
          </ToolButton>
          {pageCount > 1 && (onRotateAllCcw || onRotateAllCw) ? (
            <>
              <ToolButton
                title={`Rotate all ${pageCount} pages 90° counter-clockwise`}
                disabled={rotating || !onRotateAllCcw}
                onClick={() => onRotateAllCcw?.()}
              >
                <IconRotateAllCcw />
              </ToolButton>
              <ToolButton
                title={
                  rotating
                    ? "Rotating…"
                    : `Rotate all ${pageCount} pages 90° clockwise`
                }
                disabled={rotating || !onRotateAllCw}
                onClick={() => onRotateAllCw?.()}
              >
                <IconRotateAllCw />
              </ToolButton>
            </>
          ) : null}
        </>
      ) : null}

      <div className="ml-auto flex min-w-0 items-center gap-2.5">
        {rotateStatus ? (
          <span className="max-w-[12rem] truncate text-xs text-slate-500">{rotateStatus}</span>
        ) : null}
        {layoutDrawType ? (
          <span className="truncate text-xs font-medium text-teal-800">
            Drag to draw {layoutRegionLabel(layoutDrawType, layoutDrawLabel ?? undefined)}
          </span>
        ) : null}
        {tool === "marquee" && !drawing && !layoutDrawType && !scaleActive ? (
          <span className="truncate text-xs text-slate-500">Drag a box</span>
        ) : null}
        {drawing ? (
          <span className="truncate text-xs text-slate-500">Enter to finish · Esc to cancel</span>
        ) : null}
        {scaleMode === "calibrate" && !scaleTools?.calibrateReady ? (
          <span className="truncate text-xs text-amber-800">Click two points on a known length</span>
        ) : null}
        {scaleMode === "measure" && !scaleTools?.measureLabel ? (
          <span className="truncate text-xs text-sky-800">Click two points to measure</span>
        ) : null}
        {onDetect ? (
          <span className="max-w-[16rem] truncate text-xs text-slate-500">
            {detectError
              ? detectError
              : detecting
                ? "Running detection…"
                : regionCount > 0
                  ? `${regionCount} regions · ${modelLabel ?? "detector"}`
                  : (detectWarning ?? "")}
          </span>
        ) : null}
        <ToolDivider />
        <ToolButton
          title={toolbarPinned ? "Unpin toolbar" : "Pin toolbar"}
          active={toolbarPinned}
          onClick={toggleToolbarPinned}
        >
          <IconPin pinned={toolbarPinned} />
        </ToolButton>
      </div>
    </div>
  );
}
