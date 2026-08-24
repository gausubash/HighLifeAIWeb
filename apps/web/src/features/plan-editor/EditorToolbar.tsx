"use client";

import { clsx } from "clsx";
import { useState } from "react";
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
  { id: "mask", label: "Mask" },
];

interface EditorToolbarProps {
  onDetect?: () => void;
  detecting?: boolean;
  detectError?: string | null;
  detectWarning?: string | null;
  regionCount?: number;
  modelLabel?: string | null;
}

export function EditorToolbar({
  onDetect,
  detecting = false,
  detectError = null,
  detectWarning = null,
  regionCount = 0,
  modelLabel = null,
}: EditorToolbarProps) {
  const tool = useOverlayStore((s) => s.tool);
  const setTool = useOverlayStore((s) => s.setTool);
  const undo = useOverlayStore((s) => s.undo);
  const redo = useOverlayStore((s) => s.redo);
  const deleteSelected = useOverlayStore((s) => s.deleteSelected);
  const pages = useOverlayStore((s) => s.pages);
  const analysisId = useOverlayStore((s) => s.analysisId);
  const pageNumber = useOverlayStore((s) => s.pageNumber);
  const slice = pages[`${analysisId}:${pageNumber}`];
  const canUndo = (slice?.past.length ?? 0) > 0;
  const canRedo = (slice?.future.length ?? 0) > 0;
  const [showCorrect, setShowCorrect] = useState(false);

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
      <span className="mx-1 h-4 w-px bg-slate-200" />
      <button
        type="button"
        className={clsx(
          "rounded px-2 py-0.5 text-[11px]",
          showCorrect ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:bg-slate-100",
        )}
        onClick={() => setShowCorrect((v) => !v)}
      >
        Correct
      </button>
      {showCorrect && (
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
        </>
      )}
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
