"use client";

import { useMemo, useState } from "react";
import {
  DET_LIMIT_OPTIONS,
  OCR_LANG_OPTIONS,
  VL_MAX_SIDE_OPTIONS,
  VL_PIPELINE_OPTIONS,
  useOcrSettingsStore,
} from "./useOcrSettingsStore";
import type { PageOcrMeta } from "@highlife/shared-types";
import { formatConfidence } from "@/lib/utils";

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
  onRunPageOcr?: (profile?: "default" | "dense") => void;
  onRunTitleBlockOcr?: () => void;
  onRunDrawingAreaOcr?: () => void;
  onRunAllPagesOcr?: () => void;
  onCancelOcr?: () => void;
  onApplyDetectedScale?: () => void;
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
  onRunPageOcr,
  onRunTitleBlockOcr,
  onRunDrawingAreaOcr,
  onRunAllPagesOcr,
  onCancelOcr,
  onApplyDetectedScale,
}: OcrPanelProps) {
  const [filterText, setFilterText] = useState("");
  const [minConfFilter, setMinConfFilter] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [textBoxView, setTextBoxView] = useState<TextBoxViewMode>("all");

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
    resetDefaults,
  } = useOcrSettingsStore();
  const isVl = backend === "vl";

  const titleLines = useMemo<OcrLineItem[]>(() => {
    const raw = (ocrLines && ocrLines.length > 0) ? ocrLines : (ocrMeta?.lines ?? []);
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

  const allLines = useMemo<OcrLineItem[]>(() => {
    const combined: OcrLineItem[] = [];
    titleLines.forEach((l) => combined.push(l));
    drawingLines.forEach((l) => combined.push(l));
    return combined;
  }, [titleLines, drawingLines]);

  const activeLines = useMemo<OcrLineItem[]>(() => {
    if (textBoxView === "title_block") return titleLines;
    if (textBoxView === "drawing") return drawingLines;
    return allLines.length > 0 ? allLines : titleLines.length > 0 ? titleLines : drawingLines;
  }, [textBoxView, titleLines, drawingLines, allLines]);

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

    const formatted = linesToFormat
      .map((l) => l.text?.trim())
      .filter(Boolean)
      .join("\n");

    if (formatted) return formatted;

    if (textBoxView === "title_block" && ocrMeta?.textHint?.trim()) {
      return ocrMeta.textHint.trim();
    }
    if (textBoxView === "drawing" && drawingOcrMeta?.textHint?.trim()) {
      return drawingOcrMeta.textHint.trim();
    }
    if (textBoxView === "all") {
      const parts = [ocrMeta?.textHint?.trim(), drawingOcrMeta?.textHint?.trim()].filter(Boolean);
      if (parts.length > 0) return parts.join("\n\n");
    }

    return "";
  }, [textBoxView, titleLines, drawingLines, allLines, ocrMeta?.textHint, drawingOcrMeta?.textHint]);

  const filteredLines = useMemo<OcrLineItem[]>(() => {
    const q = filterText.trim().toLowerCase();
    return activeLines.filter((l) => {
      const txt = (l.text ?? "").toLowerCase();
      const conf = l.confidence ?? 0;
      if (minConfFilter > 0 && conf < minConfFilter) return false;
      if (q && !txt.includes(q)) return false;
      return Boolean(l.text?.trim());
    });
  }, [activeLines, filterText, minConfFilter]);

  const handleCopyTextBox = () => {
    if (!fullTextContent) return;
    navigator.clipboard.writeText(fullTextContent);
    setCopied("textbox");
    setTimeout(() => setCopied(null), 2000);
  };

  const handleCopyLines = () => {
    const textToCopy = filteredLines
      .map((l) => l.text?.trim())
      .filter(Boolean)
      .join("\n");
    if (!textToCopy) return;
    navigator.clipboard.writeText(textToCopy);
    setCopied("lines");
    setTimeout(() => setCopied(null), 2000);
  };

  const handleCopyJson = () => {
    const data = {
      sheet: ocrMeta,
      drawingOcr: drawingOcrMeta,
      titleLines,
      drawingLines,
    };
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied("json");
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="space-y-4 pb-6 text-xs text-slate-700">
      {/* Run OCR Engine Controls */}
      <div className="space-y-2 rounded-lg border border-teal-200 bg-teal-50/40 p-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold uppercase tracking-wider text-teal-900">
            PaddleOCR Engine
          </span>
          {ocrBusy ? (
            <span className="inline-flex items-center gap-1 rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-medium text-teal-800">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-teal-600" />
              Running...
            </span>
          ) : (
            <span className="text-[11px] text-teal-700">
              Page {pageNumber} of {pageCount}
            </span>
          )}
        </div>

        {ocrBusy && ocrProgress ? (
          <div className="space-y-1 pt-1">
            <div className="flex justify-between text-[11px] text-teal-800">
              <span>{ocrStatus ?? "Extracting text..."}</span>
              <span>
                {Math.round((ocrProgress.current / Math.max(1, ocrProgress.total)) * 100)}%
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-teal-200">
              <div
                className="h-full bg-teal-600 transition-all duration-200"
                style={{
                  width: `${Math.min(100, Math.round((ocrProgress.current / Math.max(1, ocrProgress.total)) * 100))}%`,
                }}
              />
            </div>
          </div>
        ) : null}

        {ocrError ? (
          <p className="rounded border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">
            {ocrError}
          </p>
        ) : null}

        {ocrNotice ? (
          <p className="rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
            {ocrNotice}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-1.5 pt-1">
          <button
            type="button"
            disabled={ocrBusy}
            onClick={() => onRunPageOcr?.("default")}
            className="rounded bg-teal-700 px-2.5 py-1.5 font-medium text-white shadow-sm hover:bg-teal-800 disabled:opacity-50"
          >
            Run Page OCR
          </button>
          <button
            type="button"
            disabled={ocrBusy}
            onClick={() => onRunTitleBlockOcr?.()}
            className="rounded border border-teal-600 bg-white px-2.5 py-1.5 font-medium text-teal-800 hover:bg-teal-50 disabled:opacity-50"
          >
            OCR Title Block
          </button>
          <button
            type="button"
            disabled={ocrBusy}
            onClick={() => onRunDrawingAreaOcr?.()}
            className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            OCR Drawing Area
          </button>
          <button
            type="button"
            disabled={ocrBusy}
            onClick={() => onRunAllPagesOcr?.()}
            className="rounded border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            OCR All Pages
          </button>
        </div>

        {ocrBusy && onCancelOcr ? (
          <button
            type="button"
            onClick={onCancelOcr}
            className="w-full rounded border border-red-300 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100"
          >
            Cancel OCR
          </button>
        ) : null}
      </div>

      {/* Detected OCR Text Box Group */}
      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-800">
            Detected OCR Text Box
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCopyTextBox}
              disabled={!fullTextContent}
              className="rounded border border-teal-600 bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-800 hover:bg-teal-100 disabled:opacity-40"
            >
              {copied === "textbox" ? "Copied!" : "Copy Text"}
            </button>
            <button
              type="button"
              onClick={handleCopyJson}
              className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-100"
            >
              {copied === "json" ? "Copied JSON!" : "JSON"}
            </button>
          </div>
        </div>

        {/* Text Box Source Filter Tabs */}
        <div className="flex gap-1 rounded bg-slate-100 p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setTextBoxView("all")}
            className={`flex-1 rounded px-2 py-1 font-medium transition-colors ${
              textBoxView === "all"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            All Text ({allLines.length})
          </button>
          <button
            type="button"
            onClick={() => setTextBoxView("title_block")}
            className={`flex-1 rounded px-2 py-1 font-medium transition-colors ${
              textBoxView === "title_block"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Title Block ({titleLines.length})
          </button>
          <button
            type="button"
            onClick={() => setTextBoxView("drawing")}
            className={`flex-1 rounded px-2 py-1 font-medium transition-colors ${
              textBoxView === "drawing"
                ? "bg-white text-slate-800 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Drawing Area ({drawingLines.length})
          </button>
        </div>

        {/* Multi-line Raw Text Box */}
        <div className="relative">
          <textarea
            readOnly
            value={fullTextContent}
            placeholder="No text detected on this page yet. Run OCR above to populate text box."
            rows={7}
            className="w-full resize-y rounded border border-slate-200 bg-slate-50/70 p-2.5 font-mono text-[11px] leading-relaxed text-slate-800 focus:border-teal-500 focus:bg-white focus:outline-none"
          />
          {fullTextContent ? (
            <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
              <span>
                {fullTextContent.split("\n").filter(Boolean).length} lines ·{" "}
                {fullTextContent.split(/\s+/).filter(Boolean).length} words ·{" "}
                {fullTextContent.length} chars
              </span>
              <span className="text-teal-700 font-medium">Selectable & copyable</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* Detected Sheet Metadata Group */}
      <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
        <span className="font-semibold uppercase tracking-wider text-slate-700">
          Detected Sheet Metadata
        </span>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded border border-slate-200 bg-white p-2">
            <span className="block text-[10px] font-medium text-slate-400">Floor Level</span>
            <span className="font-semibold text-slate-800">
              {ocrMeta?.levelName || "Not detected"}
            </span>
          </div>

          <div className="rounded border border-slate-200 bg-white p-2">
            <span className="block text-[10px] font-medium text-slate-400">Scale Ratio</span>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800">
                {ocrMeta?.scaleText || "Not detected"}
              </span>
              {ocrMeta?.scaleText && onApplyDetectedScale ? (
                <button
                  type="button"
                  onClick={onApplyDetectedScale}
                  className="rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-teal-700 shadow-sm"
                  title="Apply this OCR scale to page calibration"
                >
                  Apply
                </button>
              ) : null}
            </div>
          </div>

          <div className="col-span-2 rounded border border-slate-200 bg-white p-2">
            <span className="block text-[10px] font-medium text-slate-400">Sheet Title</span>
            <span className="font-medium text-slate-800">
              {ocrMeta?.title || "Not detected"}
            </span>
          </div>

          {ocrMeta?.unitIds && ocrMeta.unitIds.length > 0 ? (
            <div className="col-span-2 rounded border border-slate-200 bg-white p-2">
              <span className="block text-[10px] font-medium text-slate-400">
                Detected Units ({ocrMeta.unitIds.length})
              </span>
              <div className="mt-1 flex flex-wrap gap-1">
                {ocrMeta.unitIds.map((u) => (
                  <span
                    key={u}
                    className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700 border border-slate-200"
                  >
                    {u}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Extracted Lines List Group */}
      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-800">
            Line Items ({filteredLines.length}
            {activeLines.length !== filteredLines.length ? ` / ${activeLines.length}` : ""})
          </span>
          <button
            type="button"
            onClick={handleCopyLines}
            className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-100"
          >
            {copied === "lines" ? "Copied!" : "Copy Lines"}
          </button>
        </div>

        {/* Filter / Search input */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search OCR lines (e.g. Scale, Level)..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="w-full rounded border border-slate-200 px-2.5 py-1 text-xs placeholder:text-slate-400 focus:border-teal-500 focus:outline-none"
          />
        </div>

        {/* Line Items List */}
        <div className="max-h-56 space-y-1 overflow-y-auto rounded border border-slate-100 bg-slate-50/50 p-1.5">
          {filteredLines.length === 0 ? (
            <p className="py-4 text-center text-slate-400">
              {activeLines.length === 0
                ? "No OCR lines for this view yet."
                : "No lines match the search filter."}
            </p>
          ) : (
            filteredLines.map((line, idx) => {
              const conf = line.confidence ?? 0;
              const confBadgeColor =
                conf >= 0.85
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : conf >= 0.65
                    ? "bg-blue-50 text-blue-700 border-blue-200"
                    : "bg-amber-50 text-amber-700 border-amber-200";

              return (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-2 rounded border border-slate-200/80 bg-white px-2 py-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.02)] hover:border-teal-300"
                >
                  <span className="font-mono select-all text-[11px] text-slate-800">
                    {line.text}
                  </span>
                  <span
                    className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium ${confBadgeColor}`}
                  >
                    {formatConfidence(conf)}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* PaddleOCR Settings Group */}
      <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 font-semibold text-slate-800 hover:text-slate-900"
          >
            <span>PaddleOCR Options & Hyperparameters</span>
            <span className="text-[10px] text-slate-400">
              {showAdvanced ? "▲ Hide" : "▼ Show"}
            </span>
          </button>
          <button
            type="button"
            onClick={resetDefaults}
            className="text-[11px] font-medium text-teal-600 hover:text-teal-800"
            title="Reset to default PaddleOCR parameters"
          >
            Reset defaults
          </button>
        </div>

        {showAdvanced ? (
          <div className="space-y-3 pt-1">
            <div className="space-y-1">
              <label className="font-medium text-slate-800">
                Vision model (<code className="text-slate-600">backend</code>)
              </label>
              <select
                value={backend === "vl" ? "vl" : "classic"}
                onChange={(e) => setBackend(e.target.value === "vl" ? "vl" : "classic")}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 focus:border-teal-500 focus:outline-none"
              >
                <option value="classic">Classic PP-OCR (det + rec)</option>
                <option value="vl">PaddleOCR-VL 0.9B (VLM)</option>
              </select>
              <p className="text-[10px] leading-relaxed text-slate-500">
                {backend === "vl"
                  ? "Uses Hugging Face PaddlePaddle/PaddleOCR-VL. Needs paddleocr[doc-parser]≥3.4 and GPU recommended. Title-block crops work best."
                  : "Default CNN detector + recognizer (paddleocr 2.7 / PP-OCR). Fast on CPU."}
              </p>
            </div>

            {isVl ? (
              <>
                <div className="space-y-1">
                  <label className="font-medium text-slate-800">
                    Pipeline version (<code className="text-slate-600">pipeline_version</code>)
                  </label>
                  <select
                    value={pipelineVersion === "v1.5" || pipelineVersion === "v1.6" ? pipelineVersion : "v1"}
                    onChange={(e) =>
                      setPipelineVersion(e.target.value as "v1" | "v1.5" | "v1.6")
                    }
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 focus:border-teal-500 focus:outline-none"
                  >
                    {VL_PIPELINE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] leading-relaxed text-slate-500">
                    v1 uses the local PaddleOCR-VL 0.9B snapshot. v1.6 needs
                    PaddleOCR-VL-1.6-0.9B (downloaded on first run if it is not on disk).
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="flex items-start justify-between gap-2 cursor-pointer">
                    <div>
                      <div className="font-medium text-slate-800">Layout detection</div>
                      <div className="text-[10px] text-slate-500">
                        <code className="text-slate-600">use_layout_detection</code> · PP-DocLayout
                        regions before VL recognition
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={Boolean(useLayoutDetection)}
                      onChange={(e) => setUseLayoutDetection(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    />
                  </label>

                  <label className="flex items-start justify-between gap-2 cursor-pointer">
                    <div>
                      <div className="font-medium text-slate-800">Document orientation</div>
                      <div className="text-[10px] text-slate-500">
                        <code className="text-slate-600">use_doc_orientation_classify</code> · Rotate
                        90°/180°/270° pages
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={useDocOrientationClassify}
                      onChange={(e) => setUseDocOrientationClassify(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    />
                  </label>

                  <label className="flex items-start justify-between gap-2 cursor-pointer">
                    <div>
                      <div className="font-medium text-slate-800">Document unwarping</div>
                      <div className="text-[10px] text-slate-500">
                        <code className="text-slate-600">use_doc_unwarping</code> · Flatten warped
                        scans (off by default in VL)
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={useDocUnwarping}
                      onChange={(e) => setUseDocUnwarping(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    />
                  </label>

                  <label className="flex items-start justify-between gap-2 cursor-pointer">
                    <div>
                      <div className="font-medium text-slate-800">GPU acceleration</div>
                      <div className="text-[10px] text-slate-500">
                        <code className="text-slate-600">device=gpu</code> · Recommended for VL (~4GB
                        VRAM)
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={useGpu}
                      onChange={(e) => setUseGpu(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                    />
                  </label>
                </div>

                <div className="space-y-1">
                  <label className="font-medium text-slate-800">
                    Max image side (<code className="text-slate-600">vl_max_side</code>)
                  </label>
                  <select
                    value={vlMaxSide || 2048}
                    onChange={(e) => setVlMaxSide(parseInt(e.target.value, 10))}
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 focus:border-teal-500 focus:outline-none"
                  >
                    {VL_MAX_SIDE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] leading-relaxed text-slate-500">
                    VL downscales the longest side before inference. Title-block crops skip
                    layout detection automatically. First VL load on CPU can take several
                    minutes; later runs reuse the loaded model.
                  </p>
                </div>
              </>
            ) : (
              <>
            {/* Toggle Switches */}
            <div className="space-y-2">
              <label className="flex items-start justify-between gap-2 cursor-pointer">
                <div>
                  <div className="font-medium text-slate-800">
                    Document Orientation Classify
                  </div>
                  <div className="text-[10px] text-slate-500">
                    <code className="text-slate-600">use_doc_orientation_classify</code> · Rotates 90°/180°/270° orientation
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={useDocOrientationClassify}
                  onChange={(e) => setUseDocOrientationClassify(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
              </label>

              <label className="flex items-start justify-between gap-2 cursor-pointer">
                <div>
                  <div className="font-medium text-slate-800">
                    Document Unwarping
                  </div>
                  <div className="text-[10px] text-slate-500">
                    <code className="text-slate-600">use_doc_unwarping</code> · Flattens warped / folded scan curves
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={useDocUnwarping}
                  onChange={(e) => setUseDocUnwarping(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
              </label>

              <label className="flex items-start justify-between gap-2 cursor-pointer">
                <div>
                  <div className="font-medium text-slate-800">
                    Textline Orientation
                  </div>
                  <div className="text-[10px] text-slate-500">
                    <code className="text-slate-600">use_textline_orientation</code> · Angles vertical & inverted lines
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={useTextlineOrientation}
                  onChange={(e) => setUseTextlineOrientation(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
              </label>

              <label className="flex items-start justify-between gap-2 cursor-pointer">
                <div>
                  <div className="font-medium text-slate-800">
                    GPU Acceleration
                  </div>
                  <div className="text-[10px] text-slate-500">
                    <code className="text-slate-600">use_gpu</code> · Run OCR on CUDA / TensorRT when available
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={useGpu}
                  onChange={(e) => setUseGpu(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
              </label>
            </div>

            {/* Threshold Slider: text_rec_score_thresh */}
            <div className="space-y-1 rounded border border-slate-100 bg-slate-50/60 p-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-slate-800">Score Threshold</span>{" "}
                  <code className="text-[10px] text-slate-500">text_rec_score_thresh</code>
                </div>
                <span className="font-mono font-semibold text-teal-700">
                  {textRecScoreThresh.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0.0"
                max="1.0"
                step="0.05"
                value={textRecScoreThresh}
                onChange={(e) => setTextRecScoreThresh(parseFloat(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-teal-600"
              />
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>0.0 (Keep all)</span>
                <span>0.5 (Balanced)</span>
                <span>0.9 (Strict)</span>
              </div>
            </div>

            {/* Detection Resolution: det_limit_side_len */}
            <div className="space-y-1">
              <label className="font-medium text-slate-800">
                Detection Limit Side Length (<code className="text-slate-600">det_limit_side_len</code>)
              </label>
              <select
                value={detLimitSideLen}
                onChange={(e) => setDetLimitSideLen(parseInt(e.target.value, 10))}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 focus:border-teal-500 focus:outline-none"
              >
                {DET_LIMIT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <p className="text-[10px] leading-relaxed text-slate-500">
                PaddleOCR default is 960px (longest side). Larger pages are tiled at this size,
                like YOLO inference. Smaller crops are upsampled so small text stays readable.
              </p>
            </div>

            {/* Detection DB Threshold: det_db_thresh */}
            <div className="space-y-1 rounded border border-slate-100 bg-slate-50/60 p-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-slate-800">DB Binarization Thresh</span>{" "}
                  <code className="text-[10px] text-slate-500">det_db_thresh</code>
                </div>
                <span className="font-mono font-semibold text-teal-700">
                  {detDbThresh.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0.10"
                max="0.80"
                step="0.05"
                value={detDbThresh}
                onChange={(e) => setDetDbThresh(parseFloat(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-teal-600"
              />
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>0.10 (Sensitive)</span>
                <span>0.25 (Default)</span>
                <span>0.80 (Clean only)</span>
              </div>
            </div>

            {/* Language */}
            <div className="space-y-1">
              <label className="font-medium text-slate-800">
                Language Model (<code className="text-slate-600">lang</code>)
              </label>
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 focus:border-teal-500 focus:outline-none"
              >
                {OCR_LANG_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
