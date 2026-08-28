"use client";

import { clsx } from "clsx";
import { LABELME_CLASSES } from "./labelClasses";
import { layoutRegionLabel } from "./layoutRegionClasses";
import { useOverlayStore } from "./useOverlayStore";
import type { OverlayTool } from "./types";

const VIEW_TOOLS: { id: OverlayTool; label: string }[] = [
  { id: "pan", label: "Pan" },
  { id: "select", label: "Select" },
];

const DRAW_TOOLS: { id: OverlayTool; label: string }[] = [
  { id: "rect", label: "Rect" },
  { id: "polyline", label: "Line" },
  { id: "polygon", label: "Polygon" },
  { id: "point", label: "Point" },
];

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
}: EditorToolbarProps) {
  const drawClasses = classOptions ?? [...LABELME_CLASSES];
  const tool = useOverlayStore((s) => s.tool);
  const setTool = useOverlayStore((s) => s.setTool);
  const layoutDrawType = useOverlayStore((s) => s.layoutDrawType);
  const labelClass = useOverlayStore((s) => s.labelClass);
  const setLabelClass = useOverlayStore((s) => s.setLabelClass);
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
  const drawing =
    draft &&
    (draft.tool === "polygon" || draft.tool === "polyline" || draft.tool === "mask");

  return (
    <div
      className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-2 py-1"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {onDetect && (
        <button
          type="button"
          className="rounded bg-slate-900 px-2.5 py-0.5 text-[11px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          disabled={detecting}
          onClick={() => onDetect()}
        >
          {detecting ? "Detecting…" : "Detect regions"}
        </button>
      )}
      {VIEW_TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          className={clsx(
            "rounded px-2 py-0.5 text-[11px] font-medium",
            tool === t.id ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100",
          )}
          onClick={() => setTool(t.id)}
        >
          {t.label}
        </button>
      ))}
      {showDrawTools ? (
        <>
          {DRAW_TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={clsx(
                "rounded px-2 py-0.5 text-[11px] font-medium",
                tool === t.id ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100",
              )}
              onClick={() => setTool(t.id)}
            >
              {t.label}
            </button>
          ))}
          <label className="ml-1 flex items-center gap-1 text-[11px] text-slate-500">
            Class
            <select
              className="rounded border border-slate-300 bg-white px-1 py-0.5 text-[11px] text-slate-800"
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
          <span className="mx-1 h-4 w-px bg-slate-200" />
        </>
      ) : null}
      <button
        type="button"
        className="rounded px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-40"
        disabled={!canUndo}
        onClick={() => undo()}
      >
        Undo
      </button>
      <button
        type="button"
        className="rounded px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-40"
        disabled={!canRedo}
        onClick={() => redo()}
      >
        Redo
      </button>
      <button
        type="button"
        className="rounded px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-50"
        onClick={() => deleteSelected()}
      >
        Delete
      </button>
      {onRotateCw || onRotateCcw ? (
        <>
          <span className="mx-1 h-4 w-px bg-slate-200" />
          <button
            type="button"
            className="rounded px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            disabled={rotating || !onRotateCcw}
            onClick={() => onRotateCcw?.()}
            title="Rotate this page 90° counter-clockwise"
          >
            −90°
          </button>
          <button
            type="button"
            className="rounded px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            disabled={rotating || !onRotateCw}
            onClick={() => onRotateCw?.()}
            title="Rotate this page 90° clockwise"
          >
            90°
          </button>
          {pageCount > 1 && (onRotateAllCcw || onRotateAllCw) ? (
            <>
              <button
                type="button"
                className="rounded px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                disabled={rotating || !onRotateAllCcw}
                onClick={() => onRotateAllCcw?.()}
                title={`Rotate all ${pageCount} pages 90° counter-clockwise`}
              >
                −90° all
              </button>
              <button
                type="button"
                className="rounded px-2 py-0.5 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                disabled={rotating || !onRotateAllCw}
                onClick={() => onRotateAllCw?.()}
                title={`Rotate all ${pageCount} pages 90° clockwise`}
              >
                {rotating ? "Rotating…" : "90° all"}
              </button>
            </>
          ) : null}
          {rotateStatus ? (
            <span className="max-w-[12rem] truncate text-[10px] text-slate-500">{rotateStatus}</span>
          ) : null}
        </>
      ) : null}
      {layoutDrawType ? (
        <span className="text-[10px] font-medium text-teal-800">
          Drag on plan to draw {layoutRegionLabel(layoutDrawType)} · Esc cancels
        </span>
      ) : null}
      {drawing ? (
        <span className="text-[10px] text-slate-500">Enter to finish · Esc to cancel</span>
      ) : null}
      {onDetect && (
        <span className="ml-auto max-w-[55%] truncate text-[10px] text-slate-500">
          {detectError
            ? detectError
            : detecting
              ? "Running detection…"
              : regionCount > 0
                ? `${regionCount} regions · ${modelLabel ?? "detector"}`
                : (detectWarning ?? "Detects walls and fixtures on this page")}
        </span>
      )}
    </div>
  );
}
