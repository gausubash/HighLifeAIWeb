"use client";

import { useEffect, useMemo, useState } from "react";
import {
  A_PAPER_SIZES_MM,
  canonicalScaleText,
  formatMeasuredLength,
  lengthFromPixels,
  parsePaperFromText,
  parseScaleAndPaper,
  parseScaleRatio,
  pixelDistance,
  pixelsPerMeterFromScaleAndPaper,
  type PointPx,
  type ScaleInfo,
} from "@/lib/scale/parseScale";
import { scaleNeedsCalibration, shouldApplyOcrScale } from "@/lib/scale/layoutRegionCrop";
import { formatConfidence } from "@/lib/utils";
import { pdfGraphicsLabel, type PdfGraphicsKind } from "@/lib/pdf/classifyPdfGraphics";

export type ScaleToolMode = "none" | "calibrate" | "declaration" | "measure";

export interface OcrLineItem {
  text?: string | null;
  confidence?: number;
  bbox?: [number, number][] | null;
}

interface ScalePanelProps {
  scaleInfo: ScaleInfo;
  fileName?: string;
  compact?: boolean;
  toolMode?: ScaleToolMode;
  measurePoints?: PointPx[];
  renderWidthPx?: number;
  renderHeightPx?: number;
  graphicsKind?: PdfGraphicsKind;
  graphicsSummary?: string;
  ocrScaleText?: string | null;
  ocrLines?: OcrLineItem[] | null;
  scaleOcrBusy?: boolean;
  scaleOcrStatus?: string | null;
  scaleOcrProgress?: {
    current: number;
    total: number;
    pageNumber: number;
    phase: "prepare" | "ocr" | "save";
  } | null;
  scaleOcrNotice?: string | null;
  scaleOcrError?: string | null;
  titleBlockRegionSet?: boolean;
  autoScaleOcr?: boolean;
  onAutoScaleOcrChange?: (checked: boolean) => void;
  onApplyOcrScale?: () => void;
  onRunTitleBlockOcr?: () => void;
  onCancelScaleOcr?: () => void;
  onStartCalibrate?: () => void;
  onStartDeclaration?: () => void;
  onStartMeasure?: () => void;
  onCancelTool?: () => void;
  onClearPoints?: () => void;
  onApplyCalibration?: (opts: {
    realLength: number;
    realUnit: "m" | "mm";
  }) => void;
  onApplyDeclaration?: (opts: { scaleRatio: number; paper: string }) => void;
}

const METHOD_LABELS: Record<string, string> = {
  title_block_text: "Auto detect scale (OCR)",
  auto_detect_scale: "Auto detect scale (OCR)",
  ocr: "Auto detect scale (OCR)",
  paddleocr: "Auto detect scale (OCR)",
  paper_size_auto: "Paper size (1:1)",
  scale_bar_graphic: "Graphic scale bar",
  manual_two_point: "Two-point measure",
  manual_scale_paper: "Entered 1:N @ paper",
};

const PAPER_OPTIONS = Object.keys(A_PAPER_SIZES_MM);

function defaultPaper(scaleInfo: ScaleInfo): string {
  if (scaleInfo.paper && scaleInfo.paper in A_PAPER_SIZES_MM) return scaleInfo.paper;
  const fromPdf = scaleInfo.paperFromPdf?.match(/^A[0-5]/)?.[0];
  if (fromPdf && fromPdf in A_PAPER_SIZES_MM) return fromPdf;
  return "A3";
}

function scaleOcrProgressPercent(progress: {
  current: number;
  total: number;
  pageNumber: number;
  phase: "prepare" | "ocr" | "save";
}): number {
  const phaseWeight =
    progress.phase === "prepare" ? 0.15 : progress.phase === "ocr" ? 0.55 : 0.95;
  const fraction =
    progress.pageNumber > 0
      ? (progress.current - 1 + phaseWeight) / progress.total
      : 0.05;
  return Math.min(100, Math.round(100 * fraction));
}

export function ScalePanel({
  scaleInfo,
  fileName,
  compact,
  toolMode = "none",
  measurePoints = [],
  renderWidthPx,
  renderHeightPx,
  graphicsKind,
  graphicsSummary,
  ocrScaleText,
  ocrLines,
  scaleOcrBusy,
  scaleOcrStatus,
  scaleOcrProgress,
  scaleOcrNotice,
  scaleOcrError,
  titleBlockRegionSet,
  autoScaleOcr,
  onAutoScaleOcrChange,
  onApplyOcrScale,
  onRunTitleBlockOcr,
  onCancelScaleOcr,
  onStartCalibrate,
  onStartDeclaration,
  onStartMeasure,
  onCancelTool,
  onClearPoints,
  onApplyCalibration,
  onApplyDeclaration,
}: ScalePanelProps) {
  const needsCalibration = scaleNeedsCalibration(scaleInfo);
  const canApplyOcrScale = shouldApplyOcrScale(scaleInfo);
  const hasScale = scaleInfo.scaleRatio != null || scaleInfo.pixelsPerMeter != null;
  const canMeasure =
    scaleInfo.pixelsPerMeter != null && scaleInfo.pixelsPerMeter > 0;
  const [realLength, setRealLength] = useState("");
  const [realUnit, setRealUnit] = useState<"m" | "mm">("m");
  const [showAllOcrLines, setShowAllOcrLines] = useState(false);
  const [scaleRatioInput, setScaleRatioInput] = useState(
    String(scaleInfo.scaleRatio ?? 200),
  );
  const [paperInput, setPaperInput] = useState(defaultPaper(scaleInfo));

  const effectiveOcrScaleText = useMemo(() => {
    if (ocrScaleText?.trim()) return ocrScaleText.trim();
    if (ocrLines && ocrLines.length > 0) {
      return canonicalScaleText(null, null, ocrLines);
    }
    return null;
  }, [ocrScaleText, ocrLines]);

  useEffect(() => {
    if (scaleInfo.scaleRatio != null) {
      setScaleRatioInput(String(scaleInfo.scaleRatio));
    }
    if (scaleInfo.paper && scaleInfo.paper in A_PAPER_SIZES_MM) {
      setPaperInput(scaleInfo.paper);
    }
  }, [scaleInfo.scaleRatio, scaleInfo.paper]);

  useEffect(() => {
    if (!effectiveOcrScaleText) return;
    const decl = parseScaleAndPaper(effectiveOcrScaleText);
    if (decl) {
      setScaleRatioInput(String(decl.scale));
      setPaperInput(decl.paper);
      return;
    }
    const ratio = parseScaleRatio(effectiveOcrScaleText);
    if (ratio) {
      setScaleRatioInput(String(ratio));
    }
  }, [effectiveOcrScaleText]);

  const ocrScaleParsable = useMemo(() => {
    if (!effectiveOcrScaleText) return false;
    return Boolean(parseScaleAndPaper(effectiveOcrScaleText) ?? parseScaleRatio(effectiveOcrScaleText));
  }, [effectiveOcrScaleText]);

  const distPx =
    measurePoints.length >= 2
      ? pixelDistance(measurePoints[0], measurePoints[1])
      : null;

  const measured =
    distPx != null && canMeasure
      ? lengthFromPixels(distPx, scaleInfo.pixelsPerMeter!)
      : null;

  const canApplyTwoPoint =
    toolMode === "calibrate" &&
    distPx != null &&
    distPx > 0 &&
    Number(realLength) > 0 &&
    Boolean(onApplyCalibration);

  const declaredRatio = Number(scaleRatioInput);
  const declarationPreview = useMemo(() => {
    if (
      !(declaredRatio >= 1) ||
      !renderWidthPx ||
      !renderHeightPx ||
      !(paperInput in A_PAPER_SIZES_MM)
    ) {
      return null;
    }
    try {
      const ppm = pixelsPerMeterFromScaleAndPaper({
        scaleRatio: declaredRatio,
        paper: paperInput,
        renderWidthPx,
        renderHeightPx,
      });
      return ppm;
    } catch {
      return null;
    }
  }, [declaredRatio, paperInput, renderWidthPx, renderHeightPx]);

  const canApplyDeclaration =
    toolMode === "declaration" &&
    declarationPreview != null &&
    Boolean(onApplyDeclaration);

  return (
    <div className={compact ? "space-y-4" : "card space-y-4"}>
      {fileName && (
        <p className="truncate text-xs text-slate-500" title={fileName}>
          {fileName}
        </p>
      )}

      {(onRunTitleBlockOcr || effectiveOcrScaleText != null || (ocrLines && ocrLines.length > 0)) && (
        <div className="space-y-2.5 rounded border border-teal-200 bg-teal-50/50 p-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-teal-800">
              Auto detect scale (OCR)
            </p>
            {effectiveOcrScaleText ? (
              <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800">
                Parsed
              </span>
            ) : null}
          </div>

          {effectiveOcrScaleText ? (
            <div className="flex items-center justify-between gap-2 rounded border border-teal-200 bg-white px-2.5 py-2">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                  Detected Scale
                </p>
                <span className="font-mono text-sm font-bold text-teal-950">
                  {effectiveOcrScaleText}
                </span>
              </div>
              {onApplyOcrScale && ocrScaleParsable && canApplyOcrScale ? (
                <button
                  type="button"
                  className="rounded bg-teal-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-teal-800 shadow-sm disabled:opacity-50"
                  disabled={scaleOcrBusy}
                  onClick={onApplyOcrScale}
                >
                  Apply to drawing
                </button>
              ) : null}
            </div>
          ) : (
            <p className="text-xs leading-relaxed text-slate-600">
              {titleBlockRegionSet
                ? "Click auto detect scale to read drawing ratio and update px/m."
                : "Reads scale ratio and paper from title block (or draws region on Layout tab)."}
            </p>
          )}

          {/* Detected text lines from title block OCR */}
          {ocrLines && ocrLines.length > 0 && (
            <div className="space-y-1.5 rounded border border-teal-200/80 bg-white p-2 text-xs">
              <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-teal-900">
                <span>Title block text ({ocrLines.length} line{ocrLines.length === 1 ? "" : "s"})</span>
                {ocrLines.length > 4 && (
                  <button
                    type="button"
                    onClick={() => setShowAllOcrLines(!showAllOcrLines)}
                    className="font-normal text-[10px] text-teal-700 hover:underline"
                  >
                    {showAllOcrLines ? "Show less" : `Show all (${ocrLines.length})`}
                  </button>
                )}
              </div>
              <ul className="max-h-48 overflow-y-auto space-y-1 font-mono text-[11px] text-slate-800 divide-y divide-slate-100">
                {(showAllOcrLines ? ocrLines : ocrLines.slice(0, 4)).map((line, idx) => {
                  const rawText = (line.text ?? "").trim();
                  const isScaleCandidate =
                    Boolean(parseScaleAndPaper(rawText)) ||
                    Boolean(parseScaleRatio(rawText)) ||
                    Boolean(parsePaperFromText(rawText));
                  return (
                    <li
                      key={idx}
                      className={`flex items-start justify-between gap-1.5 pt-1 first:pt-0 ${
                        isScaleCandidate ? "bg-teal-50/70 -mx-1 px-1 rounded font-medium" : ""
                      }`}
                      title={line.confidence != null ? `Confidence: ${Math.round(line.confidence * 100)}%` : undefined}
                    >
                      <span className="select-none text-[10px] text-slate-400 shrink-0">
                        {idx + 1}.
                      </span>
                      <span className={`flex-1 select-text break-words ${isScaleCandidate ? "text-teal-950 font-semibold" : "text-slate-800"}`}>
                        {rawText || "(empty line)"}
                      </span>
                      {line.confidence != null && (
                        <span className="shrink-0 text-[9px] text-slate-400 ml-1">
                          {Math.round(line.confidence * 100)}%
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {onAutoScaleOcrChange ? (
            <label className="flex items-start gap-2 text-[11px] leading-snug text-slate-600">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={autoScaleOcr ?? false}
                disabled={scaleOcrBusy}
                onChange={(e) => onAutoScaleOcrChange(e.target.checked)}
              />
              <span>
                Auto-detect scale from title block OCR when not calibrated
              </span>
            </label>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {onRunTitleBlockOcr ? (
              <button
                type="button"
                className="flex-1 rounded bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                disabled={scaleOcrBusy}
                onClick={onRunTitleBlockOcr}
              >
                {scaleOcrBusy ? scaleOcrStatus ?? "Auto-detecting scale…" : "Auto detect scale"}
              </button>
            ) : null}
            {onApplyOcrScale && effectiveOcrScaleText && ocrScaleParsable && canApplyOcrScale ? (
              <button
                type="button"
                className="rounded border border-brand-300 px-3 py-1.5 text-xs font-medium text-brand-800 hover:bg-brand-50 disabled:opacity-50"
                disabled={scaleOcrBusy}
                onClick={onApplyOcrScale}
              >
                Apply OCR scale
              </button>
            ) : null}
            {scaleOcrBusy && onCancelScaleOcr ? (
              <button
                type="button"
                className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                onClick={onCancelScaleOcr}
              >
                Cancel
              </button>
            ) : null}
          </div>
          {scaleOcrBusy && scaleOcrProgress && scaleOcrProgress.total > 0 ? (
            <div className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-teal-600 transition-all"
                  style={{ width: `${scaleOcrProgressPercent(scaleOcrProgress)}%` }}
                />
              </div>
              {scaleOcrStatus ? (
                <p className="text-[11px] leading-relaxed text-slate-600">{scaleOcrStatus}</p>
              ) : null}
            </div>
          ) : null}
          {scaleOcrNotice ? (
            <p className="text-[11px] leading-relaxed text-emerald-700">{scaleOcrNotice}</p>
          ) : null}
          {scaleOcrError ? (
            <p className="text-[11px] leading-relaxed text-red-600">{scaleOcrError}</p>
          ) : null}
          {effectiveOcrScaleText && !ocrScaleParsable ? (
            <p className="text-[11px] leading-relaxed text-amber-700">
              OCR text could not be parsed as 1:N @ paper — enter scale manually.
            </p>
          ) : null}
        </div>
      )}

      {(onStartCalibrate || onStartMeasure || onStartDeclaration) && (
        <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Tools
          </p>

          {toolMode === "none" && (
            <>
              <p className="text-xs leading-relaxed text-slate-600">
                Detect scale automatically with OCR, enter 1:N and paper size, or calibrate from two points.
              </p>
              <div className="flex flex-col gap-2">
                {onRunTitleBlockOcr && (
                  <button
                    type="button"
                    className="flex items-center justify-center gap-1.5 rounded bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                    disabled={scaleOcrBusy}
                    onClick={onRunTitleBlockOcr}
                  >
                    <span>{scaleOcrBusy ? scaleOcrStatus ?? "Auto-detecting scale…" : "Auto detect scale (OCR)"}</span>
                  </button>
                )}
                {onStartDeclaration && (
                  <button
                    type="button"
                    className="btn-primary w-full text-xs"
                    onClick={onStartDeclaration}
                  >
                    Enter 1:N @ paper
                  </button>
                )}
                {onStartCalibrate && (
                  <button
                    type="button"
                    className="btn-secondary w-full text-xs"
                    onClick={onStartCalibrate}
                  >
                    Two-point calibrate
                  </button>
                )}
                {onStartMeasure && (
                  <button
                    type="button"
                    className="btn-secondary w-full text-xs"
                    disabled={!canMeasure}
                    title={
                      canMeasure ? undefined : "Set scale first (need px/m)"
                    }
                    onClick={onStartMeasure}
                  >
                    Measure length
                  </button>
                )}
              </div>
              {!canMeasure && (
                <p className="text-[10px] text-slate-500">
                  Measure unlocks after you set a scale.
                </p>
              )}
            </>
          )}

          {toolMode === "declaration" && (
            <>
              <p className="text-xs font-medium text-teal-900">Drawing scale</p>
              <p className="text-xs leading-relaxed text-slate-600">
                Use the title-block scale, e.g. 1:200 on A3. This maps the page
                image to real metres.
              </p>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-600">1:</span>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  step={1}
                  inputMode="numeric"
                  value={scaleRatioInput}
                  onChange={(e) => setScaleRatioInput(e.target.value)}
                  className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
                <select
                  value={paperInput}
                  onChange={(e) => setPaperInput(e.target.value)}
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                >
                  {PAPER_OPTIONS.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
              {declarationPreview != null && (
                <p className="font-mono text-xs text-slate-800">
                  1:{declaredRatio} @ {paperInput} → {declarationPreview.toFixed(2)}{" "}
                  px/m
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary flex-1 text-xs"
                  disabled={!canApplyDeclaration}
                  onClick={() => {
                    if (!canApplyDeclaration || !onApplyDeclaration) return;
                    onApplyDeclaration({
                      scaleRatio: declaredRatio,
                      paper: paperInput,
                    });
                  }}
                >
                  Apply scale
                </button>
                {onCancelTool && (
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={onCancelTool}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </>
          )}

          {toolMode === "calibrate" && (
            <>
              <p className="text-xs font-medium text-amber-900">Calibrating</p>
              <p className="text-xs leading-relaxed text-slate-600">
                {measurePoints.length < 2
                  ? `Click point ${measurePoints.length + 1} of 2 on the plan.`
                  : "Enter the real length between those points."}
              </p>
              {distPx != null && (
                <p className="font-mono text-xs text-slate-800">
                  Measured: {distPx.toFixed(1)} px
                  {Number(realLength) > 0 && (
                    <>
                      {" "}
                      →{" "}
                      {(
                        distPx /
                        (realUnit === "mm"
                          ? Number(realLength) / 1000
                          : Number(realLength))
                      ).toFixed(2)}{" "}
                      px/m
                    </>
                  )}
                </p>
              )}
              {measurePoints.length >= 2 && (
                <>
                  <p className="text-[10px] leading-relaxed text-slate-500">
                    Use the real length of the segment you clicked (e.g. a
                    dimension labelled 5.000 → enter 5 and unit m).
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      placeholder="Length"
                      value={realLength}
                      onChange={(e) => setRealLength(e.target.value)}
                      className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
                    />
                    <select
                      value={realUnit}
                      onChange={(e) => setRealUnit(e.target.value as "m" | "mm")}
                      className="rounded border border-slate-300 px-2 py-1.5 text-sm"
                    >
                      <option value="m">m</option>
                      <option value="mm">mm</option>
                    </select>
                  </div>
                </>
              )}
              <div className="flex flex-wrap gap-2">
                {measurePoints.length >= 2 && (
                  <button
                    type="button"
                    className="btn-primary flex-1 text-xs"
                    disabled={!canApplyTwoPoint}
                    onClick={() => {
                      if (!canApplyTwoPoint || !onApplyCalibration) return;
                      onApplyCalibration({
                        realLength: Number(realLength),
                        realUnit,
                      });
                      setRealLength("");
                    }}
                  >
                    Apply px → real
                  </button>
                )}
                {onClearPoints && measurePoints.length > 0 && (
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={onClearPoints}
                  >
                    Clear points
                  </button>
                )}
                {onCancelTool && (
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => {
                      setRealLength("");
                      onCancelTool();
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </>
          )}

          {toolMode === "measure" && (
            <>
              <p className="text-xs font-medium text-sky-900">Measuring</p>
              <p className="text-xs leading-relaxed text-slate-600">
                {measurePoints.length < 2
                  ? `Click point ${measurePoints.length + 1} of 2 to measure a length.`
                  : "Compare this length to a known dimension on the plan."}
              </p>
              {distPx != null && measured && (
                <div className="rounded border border-sky-200 bg-sky-50 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-800">
                    Length
                  </p>
                  <p className="mt-0.5 font-display text-xl font-semibold text-sky-950">
                    {formatMeasuredLength(measured.meters)}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-sky-900/80">
                    {distPx.toFixed(1)} px · {measured.meters.toFixed(4)} m ·{" "}
                    {measured.millimetres.toFixed(1)} mm
                  </p>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {onClearPoints && (
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={onClearPoints}
                  >
                    {measurePoints.length >= 2 ? "Measure again" : "Clear points"}
                  </button>
                )}
                {onCancelTool && (
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={onCancelTool}
                  >
                    Done
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {hasScale ? (
        <dl className="space-y-3">
          {scaleInfo.scaleRatio != null && (
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Drawing scale
              </dt>
              <dd className="mt-0.5 text-lg font-semibold text-slate-900">
                1:{scaleInfo.scaleRatio}
                {scaleInfo.paper && (
                  <span className="ml-1.5 text-sm font-normal text-slate-600">
                    @ {scaleInfo.paper}
                  </span>
                )}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Confidence
            </dt>
            <dd className="mt-0.5 text-sm font-medium">
              {formatConfidence(scaleInfo.confidence)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Method
            </dt>
            <dd className="mt-0.5 text-sm text-slate-800">
              {METHOD_LABELS[scaleInfo.method] ?? scaleInfo.method}
            </dd>
          </div>
          {scaleInfo.pixelsPerMeter != null && (
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Pixels per meter
              </dt>
              <dd className="mt-0.5 font-mono text-sm text-slate-800">
                {scaleInfo.pixelsPerMeter.toFixed(2)} px/m
              </dd>
              <dd className="text-xs text-slate-500">
                {(1 / scaleInfo.pixelsPerMeter).toExponential(3)} m/px
              </dd>
            </div>
          )}
        </dl>
      ) : (
        <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          No scale yet. Enter <span className="font-mono">1:200 @ A3</span>, or
          use two-point calibration on a known length.
        </div>
      )}

      <hr className="border-slate-200" />

      <dl className="space-y-3">
        {graphicsKind && (
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              PDF graphics
            </dt>
            <dd className="mt-0.5 text-sm font-medium text-slate-800">
              {pdfGraphicsLabel(graphicsKind)}
            </dd>
            {graphicsSummary && (
              <dd className="text-xs leading-relaxed text-slate-500">{graphicsSummary}</dd>
            )}
          </div>
        )}
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            PDF page size
          </dt>
          <dd className="mt-0.5 text-sm text-slate-800">
            {scaleInfo.pageWidthMm} × {scaleInfo.pageHeightMm} mm
          </dd>
          <dd className="text-xs text-slate-500">
            {Math.round(scaleInfo.pageWidthPt)} × {Math.round(scaleInfo.pageHeightPt)} pt
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Detected paper
          </dt>
          <dd className="mt-0.5 text-sm text-slate-800">
            {scaleInfo.paperFromPdf ?? "Unknown"}
          </dd>
        </div>
      </dl>

      {scaleInfo.scaleLabel && (
        <p className="text-[10px] text-slate-500">Label: {scaleInfo.scaleLabel}</p>
      )}
    </div>
  );
}
