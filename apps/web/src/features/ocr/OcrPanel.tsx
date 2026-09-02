"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  DET_LIMIT_OPTIONS,
  OCR_LANG_OPTIONS,
  VL_MAX_SIDE_OPTIONS,
  VL_PIPELINE_OPTIONS,
  useOcrSettingsStore,
} from "./useOcrSettingsStore";
import type { PageOcrMeta } from "@highlife/shared-types";
import { formatConfidence } from "@/lib/utils";
import type { PdfGraphicsKind } from "@/lib/pdf/classifyPdfGraphics";
import type { OcrLineSource } from "@/lib/ocr/removeOcrLine";

export interface OcrLineItem {
  text?: string | null;
  confidence?: number;
  bbox?: [number, number][] | null;
}

interface OcrPanelProps {
  pageNumber: number;
  pageCount: number;
  ocrMeta?: PageOcrMeta | null;
  drawingOcrMeta?: PageOcrMeta | null;
  ocrLines?: OcrLineItem[] | null;
  ocrBusy?: boolean;
  ocrStatus?: string | null;
  ocrProgress?: {
    current: number;
    total: number;
    pageNumber: number;
    phase: "prepare" | "ocr" | "save";
  } | null;
  ocrNotice?: string | null;
  ocrError?: string | null;
  graphicsKind?: PdfGraphicsKind | string | null;
  onRunPageOcr?: (profile?: "default" | "dense") => void;
  onRunTitleBlockOcr?: () => void;
  onRunDrawingAreaOcr?: () => void;
  onRunAllPagesOcr?: () => void;
  onRunOcr?: (opts: { title: boolean; drawing: boolean; allPages: boolean }) => void;
  onExtractPdfText?: (opts: {
    title: boolean;
    drawing: boolean;
    allPages: boolean;
  }) => void;
  onCancelOcr?: () => void;
  onApplyDetectedScale?: () => boolean | void;
  /** Active drawing scale from calibration / declaration (shown in OCR tab). */
  activeScaleLabel?: string | null;
  /** How the active scale was set (title block, manual, calibrate…). */
  scaleMethod?: string | null;
  onDeleteOcrLine?: (source: OcrLineSource, index: number) => void;
  onClearOcrLines?: (source: TextBoxViewMode) => void;
}

type TextBoxViewMode = "all" | "title_block" | "drawing";

function parseOcrLine(item: unknown): OcrLineItem | null {
  if (!item) return null;
  if (typeof item === "string") {
    const t = item.trim();
    return t ? { text: t, confidence: 1 } : null;
  }
  if (typeof item === "object") {
    const obj = item as Record<string, unknown>;
    const text = String(
      obj.text ?? obj.recText ?? obj.rec_text ?? obj.content ?? obj.label ?? "",
    ).trim();
    if (!text) return null;
    const confidence =
      typeof obj.confidence === "number"
        ? obj.confidence
        : typeof obj.score === "number"
          ? obj.score
          : undefined;
    const bbox = Array.isArray(obj.bbox) ? (obj.bbox as [number, number][]) : undefined;
    return { text, confidence, bbox };
  }
  return null;
}

function formatOcrBbox(bbox: [number, number][] | null | undefined): string | null {
  if (!bbox || bbox.length < 2) return null;
  const xs = bbox.map((p) => Number(p[0])).filter((n) => Number.isFinite(n));
  const ys = bbox.map((p) => Number(p[1])).filter((n) => Number.isFinite(n));
  if (!xs.length || !ys.length) return null;
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0;
  const h = Math.max(...ys) - y0;
  return `${Math.round(x0)},${Math.round(y0)}  ${Math.round(w)}×${Math.round(h)}`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-12 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function OcrPanel({
  pageNumber,
  pageCount,
  ocrMeta,
  drawingOcrMeta,
  ocrLines,
  ocrBusy,
  ocrStatus,
  ocrProgress,
  ocrNotice,
  ocrError,
  graphicsKind,
  onRunPageOcr,
  onRunTitleBlockOcr,
  onRunDrawingAreaOcr,
  onRunAllPagesOcr,
  onRunOcr,
  onExtractPdfText,
  onCancelOcr,
  onApplyDetectedScale,
  activeScaleLabel,
  scaleMethod,
  onDeleteOcrLine,
  onClearOcrLines,
}: OcrPanelProps) {
  const [filterText, setFilterText] = useState("");
  const [scaleApplyState, setScaleApplyState] = useState<"idle" | "ok" | "fail">("idle");

  useEffect(() => {
    setScaleApplyState("idle");
  }, [ocrMeta?.scaleText, pageNumber]);
  const [copied, setCopied] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [textBoxView, setTextBoxView] = useState<TextBoxViewMode>("all");
  const [doTitle, setDoTitle] = useState(true);
  const [doDrawing, setDoDrawing] = useState(true);
  const [doAllPages, setDoAllPages] = useState(false);

  const {
    useDocOrientationClassify,
    useDocUnwarping,
    useTextlineOrientation,
    textRecScoreThresh,
    detLimitSideLen,
    detDbThresh,
    lang,
    useGpu,
    backend,
    pipelineVersion,
    useLayoutDetection,
    vlMaxSide,
    tileTitleBlock,
    tileDrawing,
    setUseDocOrientationClassify,
    setUseDocUnwarping,
    setUseTextlineOrientation,
    setTextRecScoreThresh,
    setDetLimitSideLen,
    setDetDbThresh,
    setLang,
    setUseGpu,
    setBackend,
    setPipelineVersion,
    setUseLayoutDetection,
    setVlMaxSide,
    setTileTitleBlock,
    setTileDrawing,
    resetDefaults,
  } = useOcrSettingsStore();
  const isVl = backend === "vl";
  const digitalPdf =
    graphicsKind === "vector" || graphicsKind === "hybrid" || graphicsKind === "unknown" || graphicsKind == null;
  const pdfTextProvider =
    ocrMeta?.provider === "pdf-text" || drawingOcrMeta?.provider === "pdf-text";

  const titleLines = useMemo<OcrLineItem[]>(() => {
    const raw = ocrLines && ocrLines.length > 0 ? ocrLines : (ocrMeta?.lines ?? []);
    const parsed = raw.map(parseOcrLine).filter((l): l is OcrLineItem => l !== null);
    if (parsed.length > 0) return parsed;
    if (ocrMeta?.textHint?.trim()) {
      return ocrMeta.textHint
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((text) => ({ text, confidence: ocrMeta.confidence ?? 0.85 }));
    }
    return [];
  }, [ocrLines, ocrMeta]);

  const drawingLines = useMemo<OcrLineItem[]>(() => {
    const raw = drawingOcrMeta?.lines ?? [];
    const parsed = raw.map(parseOcrLine).filter((l): l is OcrLineItem => l !== null);
    if (parsed.length > 0) return parsed;
    if (drawingOcrMeta?.textHint?.trim()) {
      return drawingOcrMeta.textHint
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((text) => ({ text, confidence: drawingOcrMeta.confidence ?? 0.85 }));
    }
    return [];
  }, [drawingOcrMeta]);

  const allLines = useMemo<OcrLineItem[]>(() => [...titleLines, ...drawingLines], [titleLines, drawingLines]);

  const fullTextContent = useMemo<string>(() => {
    const linesToFormat =
      textBoxView === "title_block"
        ? titleLines
        : textBoxView === "drawing"
          ? drawingLines
          : allLines.length > 0
            ? allLines
            : titleLines.length > 0
              ? titleLines
              : drawingLines;
    const formatted = linesToFormat.map((l) => l.text?.trim()).filter(Boolean).join("\n");
    if (formatted) return formatted;
    if (textBoxView === "title_block" && ocrMeta?.textHint?.trim()) return ocrMeta.textHint.trim();
    if (textBoxView === "drawing" && drawingOcrMeta?.textHint?.trim()) return drawingOcrMeta.textHint.trim();
    if (textBoxView === "all") {
      const parts = [ocrMeta?.textHint?.trim(), drawingOcrMeta?.textHint?.trim()].filter(Boolean);
      if (parts.length > 0) return parts.join("\n\n");
    }
    return "";
  }, [textBoxView, titleLines, drawingLines, allLines, ocrMeta?.textHint, drawingOcrMeta?.textHint]);

  const activeLineRefs = useMemo(() => {
    const title = titleLines.map((line, index) => ({
      line,
      source: "title_block" as const,
      index,
    }));
    const drawing = drawingLines.map((line, index) => ({
      line,
      source: "drawing" as const,
      index,
    }));
    if (textBoxView === "title_block") return title;
    if (textBoxView === "drawing") return drawing;
    return [...title, ...drawing];
  }, [textBoxView, titleLines, drawingLines]);

  const filteredLineRefs = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return activeLineRefs.filter(({ line }) => {
      const txt = (line.text ?? "").toLowerCase();
      if (q && !txt.includes(q)) return false;
      return Boolean(line.text?.trim());
    });
  }, [activeLineRefs, filterText]);

  const copy = (key: string, text: string) => {
    if (!text) return;
    void navigator.clipboard.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1600);
  };

  const pageChecked = doTitle && doDrawing;

  const runOcr = () => {
    if (!doTitle && !doDrawing) return;
    if (onRunOcr) {
      onRunOcr({ title: doTitle, drawing: doDrawing, allPages: doAllPages });
      return;
    }
    if (doAllPages && doTitle && doDrawing) {
      onRunAllPagesOcr?.();
      return;
    }
    if (doTitle) onRunTitleBlockOcr?.();
    if (doDrawing) onRunDrawingAreaOcr?.();
  };

  const progressPct = ocrProgress
    ? Math.min(100, Math.round((ocrProgress.current / Math.max(1, ocrProgress.total)) * 100))
    : 0;

  return (
    <div className="space-y-3 text-[13px] text-slate-700">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {ocrBusy ? (
            <button type="button" className="btn-compact-secondary" onClick={() => onCancelOcr?.()}>
              Cancel
            </button>
          ) : (
            <div className="btn-segment-group" role="group" aria-label="Extract text">
              <button
                type="button"
                className="btn-segment"
                disabled={
                  (!doTitle && !doDrawing) ||
                  (!onRunOcr && !onRunPageOcr && !onRunTitleBlockOcr && !onRunDrawingAreaOcr)
                }
                title={
                  doAllPages
                    ? `Scan title and/or drawing on all ${pageCount} pages`
                    : `Scan title and/or drawing on page ${pageNumber}`
                }
                onClick={runOcr}
              >
                Run OCR
              </button>
              {onExtractPdfText ? (
                <button
                  type="button"
                  className="btn-segment"
                  disabled={graphicsKind === "image" || (!doTitle && !doDrawing)}
                  title={
                    graphicsKind === "image"
                      ? "This page is a raster image, not a digital PDF"
                      : doAllPages
                        ? `Read selectable PDF text in the checked Title / Drawing areas on all ${pageCount} pages`
                        : `Read selectable PDF text in the checked Title / Drawing areas on page ${pageNumber}`
                  }
                  onClick={() =>
                    onExtractPdfText({
                      title: doTitle,
                      drawing: doDrawing,
                      allPages: doAllPages,
                    })
                  }
                >
                  Digital PDF
                </button>
              ) : null}
            </div>
          )}
          <label className="flex items-center gap-1 text-[13px] text-slate-700">
            <input
              type="checkbox"
              className="accent-slate-900"
              checked={pageChecked}
              disabled={ocrBusy}
              onChange={(e) => {
                const next = e.target.checked;
                setDoTitle(next);
                setDoDrawing(next);
              }}
            />
            Page
          </label>
          <label className="flex items-center gap-1 text-[13px] text-slate-700">
            <input
              type="checkbox"
              className="accent-slate-900"
              checked={doTitle}
              disabled={ocrBusy}
              onChange={(e) => setDoTitle(e.target.checked)}
            />
            Title
          </label>
          <label className="flex items-center gap-1 text-[13px] text-slate-700">
            <input
              type="checkbox"
              className="accent-slate-900"
              checked={doDrawing}
              disabled={ocrBusy}
              onChange={(e) => setDoDrawing(e.target.checked)}
            />
            Drawing
          </label>
          <label className="flex items-center gap-1 text-[13px] text-slate-700">
            <input
              type="checkbox"
              className="accent-slate-900"
              checked={doAllPages}
              disabled={ocrBusy || pageCount < 2}
              onChange={(e) => setDoAllPages(e.target.checked)}
            />
            {pageCount > 1 ? `All ${pageCount}` : "All"}
          </label>
        </div>
        {ocrBusy ? (
          <div className="space-y-0.5">
            <div className="h-1 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="text-xs leading-snug text-slate-500">
              {ocrStatus ?? "Extracting text…"}
              {ocrProgress ? ` · ${progressPct}%` : ""}
            </p>
          </div>
        ) : null}
        {ocrError ? <p className="text-xs leading-snug text-red-600">{ocrError}</p> : null}
        {ocrNotice ? <p className="text-xs leading-snug text-amber-700">{ocrNotice}</p> : null}
        {digitalPdf && !ocrBusy && onExtractPdfText ? (
          <p className="text-xs leading-snug text-slate-500">
            Digital PDF reads selectable text in the Title / Drawing areas you check. Run Auto
            layout first so those zones exist.
          </p>
        ) : null}
      </div>

      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Sheet</p>
        {ocrMeta?.provider || drawingOcrMeta?.provider ? (
          <Row label="Source">
            <p className="truncate text-[13px] text-slate-800">
              {pdfTextProvider ? "Digital PDF" : ocrMeta?.provider || drawingOcrMeta?.provider}
            </p>
          </Row>
        ) : null}
        <Row label="Floor">
          <p className="truncate text-[13px] text-slate-800">{ocrMeta?.levelName || "—"}</p>
        </Row>
        <Row label="Scale">
          <div className="flex items-center gap-1">
            <p className="min-w-0 flex-1 truncate text-[13px] text-slate-800">{ocrMeta?.scaleText || "—"}</p>
            {ocrMeta?.scaleText && onApplyDetectedScale ? (
              <button
                type="button"
                className={
                  scaleApplyState === "fail"
                    ? "h-5 shrink-0 rounded bg-red-700 px-1.5 text-xs font-medium text-white hover:bg-red-800"
                    : scaleApplyState === "ok"
                      ? "h-5 shrink-0 rounded bg-teal-700 px-1.5 text-xs font-medium text-white hover:bg-teal-800"
                      : "btn-compact-primary h-5 px-1.5"
                }
                onClick={() => {
                  const ok = onApplyDetectedScale();
                  setScaleApplyState(ok === false ? "fail" : "ok");
                }}
              >
                {scaleApplyState === "fail" ? "Failed" : scaleApplyState === "ok" ? "Applied" : "Apply"}
              </button>
            ) : null}
          </div>
        </Row>
        {activeScaleLabel ? (
          <Row label="Active">
            <p className="truncate text-[13px] tabular-nums text-slate-800">{activeScaleLabel}</p>
          </Row>
        ) : null}
        {scaleMethod ? (
          <Row label="Method">
            <p className="truncate text-[13px] text-slate-800" title={scaleMethod}>
              {scaleMethod}
            </p>
          </Row>
        ) : null}
        <Row label="Title">
          <p className="truncate text-[13px] text-slate-800" title={ocrMeta?.title ?? undefined}>
            {ocrMeta?.title || "—"}
          </p>
        </Row>
        {ocrMeta?.unitIds && ocrMeta.unitIds.length > 0 ? (
          <Row label="Units">
            <p className="truncate text-[13px] tabular-nums text-slate-800">{ocrMeta.unitIds.join(" · ")}</p>
          </Row>
        ) : null}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Text</p>
          <div className="flex gap-1">
            {(onClearOcrLines && activeLineRefs.length > 0) ? (
              <button
                type="button"
                className="h-5 rounded border border-slate-300 px-1.5 text-xs text-red-700 hover:bg-red-50"
                title="Remove all lines in the current view"
                onClick={() => onClearOcrLines(textBoxView)}
              >
                Clear
              </button>
            ) : null}
            <button
              type="button"
              disabled={!fullTextContent}
              className="h-5 rounded border border-slate-300 px-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              onClick={() => copy("text", fullTextContent)}
            >
              {copied === "text" ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              className="h-5 rounded border border-slate-300 px-1.5 text-xs text-slate-700 hover:bg-slate-50"
              onClick={() =>
                copy(
                  "json",
                  JSON.stringify({ sheet: ocrMeta, drawingOcr: drawingOcrMeta, titleLines, drawingLines }, null, 2),
                )
              }
            >
              {copied === "json" ? "Copied" : "JSON"}
            </button>
          </div>
        </div>
        <div className="flex gap-0.5 rounded bg-slate-100 p-0.5">
          {(
            [
              ["all", `All ${allLines.length}`],
              ["title_block", `Title ${titleLines.length}`],
              ["drawing", `Draw ${drawingLines.length}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`h-5 flex-1 rounded text-xs font-medium ${
                textBoxView === id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
              onClick={() => setTextBoxView(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <textarea
          readOnly
          value={fullTextContent}
          placeholder="Run OCR or PDF text to fill this page."
          rows={5}
          className="w-full resize-y rounded border border-slate-200 bg-white px-1.5 py-1 font-mono text-[13px] leading-snug text-slate-800"
        />
      </div>

      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Lines · {filteredLineRefs.length}
        </p>
        <input
          type="text"
          placeholder="Search lines…"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="h-6 w-full rounded border border-slate-300 px-1.5 text-[13px] placeholder:text-slate-400"
        />
        <ul className="max-h-44 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 bg-white">
          {filteredLineRefs.length === 0 ? (
            <li className="px-1.5 py-2 text-center text-xs text-slate-400">
              {activeLineRefs.length === 0 ? "No lines yet" : "No match"}
            </li>
          ) : (
            filteredLineRefs.map(({ line, source, index }) => {
              const box = formatOcrBbox(line.bbox);
              return (
              <li key={`${source}:${index}:${line.text}`} className="group flex items-start gap-1 px-1.5 py-1 hover:bg-slate-50">
                <span className="min-w-0 flex-1 font-mono text-[13px] leading-snug text-slate-800">
                  <span className="block truncate">{line.text}</span>
                  {box ? (
                    <span className="block tabular-nums text-xs text-slate-400">{box}</span>
                  ) : null}
                </span>
                <span className="shrink-0 tabular-nums text-xs text-slate-400">
                  {line.confidence != null && line.confidence < 0.999
                    ? formatConfidence(line.confidence)
                    : pdfTextProvider
                      ? "PDF"
                      : formatConfidence(line.confidence ?? 0)}
                </span>
                {onDeleteOcrLine ? (
                  <button
                    type="button"
                    className="h-5 shrink-0 rounded px-1 text-xs text-slate-400 opacity-0 hover:text-red-700 group-hover:opacity-100"
                    title="Remove line"
                    onClick={() => onDeleteOcrLine(source, index)}
                  >
                    ×
                  </button>
                ) : null}
              </li>
              );
            })
          )}
        </ul>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-600"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            Options {showAdvanced ? "▴" : "▾"}
          </button>
          {showAdvanced ? (
            <button type="button" className="text-xs text-slate-500 hover:text-slate-800" onClick={resetDefaults}>
              Reset
            </button>
          ) : null}
        </div>
        {showAdvanced ? (
          <div className="space-y-1.5">
            <Row label="Engine">
              <select
                className="h-6 w-full rounded border border-slate-300 bg-white px-1 text-[13px]"
                value={isVl ? "vl" : "classic"}
                onChange={(e) => setBackend(e.target.value === "vl" ? "vl" : "classic")}
              >
                <option value="classic">Classic PP-OCR</option>
                <option value="vl">PaddleOCR-VL</option>
              </select>
            </Row>
            <Row label="Lang">
              <select
                className="h-6 w-full rounded border border-slate-300 bg-white px-1 text-[13px]"
                value={lang}
                onChange={(e) => setLang(e.target.value)}
              >
                {OCR_LANG_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="GPU">
              <input
                type="checkbox"
                className="accent-slate-900"
                checked={useGpu}
                onChange={(e) => setUseGpu(e.target.checked)}
              />
            </Row>
            {isVl ? (
              <>
                <Row label="Pipe">
                  <select
                    className="h-6 w-full rounded border border-slate-300 bg-white px-1 text-[13px]"
                    value={pipelineVersion === "v1.5" || pipelineVersion === "v1.6" ? pipelineVersion : "v1"}
                    onChange={(e) => setPipelineVersion(e.target.value as "v1" | "v1.5" | "v1.6")}
                  >
                    {VL_PIPELINE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Side">
                  <select
                    className="h-6 w-full rounded border border-slate-300 bg-white px-1 text-[13px]"
                    value={vlMaxSide || 0}
                    onChange={(e) => setVlMaxSide(parseInt(e.target.value, 10))}
                  >
                    {VL_MAX_SIDE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Layout">
                  <input
                    type="checkbox"
                    className="accent-slate-900"
                    checked={Boolean(useLayoutDetection)}
                    onChange={(e) => setUseLayoutDetection(e.target.checked)}
                  />
                </Row>
                <Row label="Orient">
                  <input
                    type="checkbox"
                    className="accent-slate-900"
                    checked={useDocOrientationClassify}
                    onChange={(e) => setUseDocOrientationClassify(e.target.checked)}
                    title="Whole-photo rotation. Drawing OCR turns this off so boxes stay on the printed text."
                  />
                </Row>
                <Row label="Unwarp">
                  <input
                    type="checkbox"
                    className="accent-slate-900"
                    checked={useDocUnwarping}
                    onChange={(e) => setUseDocUnwarping(e.target.checked)}
                  />
                </Row>
              </>
            ) : (
              <>
                <Row label="Tiles">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1 text-[13px] text-slate-700" title="Split the title-block crop into overlapping windows. Can cut scale / paper lines in half.">
                      <input
                        type="checkbox"
                        className="accent-slate-900"
                        checked={tileTitleBlock}
                        onChange={(e) => setTileTitleBlock(e.target.checked)}
                      />
                      Title
                    </label>
                    <label className="flex items-center gap-1 text-[13px] text-slate-700" title="Split the drawing-area crop into overlapping windows. Can cut room names and dimensions.">
                      <input
                        type="checkbox"
                        className="accent-slate-900"
                        checked={tileDrawing}
                        onChange={(e) => setTileDrawing(e.target.checked)}
                      />
                      Drawing
                    </label>
                  </div>
                </Row>
                <Row label="Orient">
                  <input
                    type="checkbox"
                    className="accent-slate-900"
                    checked={useDocOrientationClassify}
                    onChange={(e) => setUseDocOrientationClassify(e.target.checked)}
                    title="Whole-photo rotation. Drawing OCR turns this off so boxes stay on the printed text."
                  />
                </Row>
                <Row label="Unwarp">
                  <input
                    type="checkbox"
                    className="accent-slate-900"
                    checked={useDocUnwarping}
                    onChange={(e) => setUseDocUnwarping(e.target.checked)}
                  />
                </Row>
                <Row label="Lines">
                  <input
                    type="checkbox"
                    className="accent-slate-900"
                    checked={useTextlineOrientation}
                    onChange={(e) => setUseTextlineOrientation(e.target.checked)}
                  />
                </Row>
                <Row label="Score">
                  <div className="flex items-center gap-1">
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={textRecScoreThresh}
                      onChange={(e) => setTextRecScoreThresh(parseFloat(e.target.value))}
                      className="h-1.5 min-w-0 flex-1 accent-slate-900"
                    />
                    <span className="w-8 shrink-0 text-right tabular-nums text-xs text-slate-500">
                      {textRecScoreThresh.toFixed(2)}
                    </span>
                  </div>
                </Row>
                <Row label="DB">
                  <div className="flex items-center gap-1">
                    <input
                      type="range"
                      min="0.10"
                      max="0.80"
                      step="0.05"
                      value={detDbThresh}
                      onChange={(e) => setDetDbThresh(parseFloat(e.target.value))}
                      className="h-1.5 min-w-0 flex-1 accent-slate-900"
                    />
                    <span className="w-8 shrink-0 text-right tabular-nums text-xs text-slate-500">
                      {detDbThresh.toFixed(2)}
                    </span>
                  </div>
                </Row>
                <Row label="Det">
                  <select
                    className="h-6 w-full rounded border border-slate-300 bg-white px-1 text-[13px]"
                    value={detLimitSideLen || 0}
                    onChange={(e) => setDetLimitSideLen(parseInt(e.target.value, 10))}
                  >
                    {DET_LIMIT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </Row>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
