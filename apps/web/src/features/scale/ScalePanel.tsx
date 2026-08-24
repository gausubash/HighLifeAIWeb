"use client";

import { useMemo, useState } from "react";
import {
  A_PAPER_SIZES_MM,
  formatMeasuredLength,
  lengthFromPixels,
  pixelDistance,
  pixelsPerMeterFromScaleAndPaper,
  type PointPx,
  type ScaleInfo,
} from "@/lib/scale/parseScale";
import { formatConfidence } from "@/lib/utils";
import { pdfGraphicsLabel, type PdfGraphicsKind } from "@/lib/pdf/classifyPdfGraphics";

export type ScaleToolMode = "none" | "calibrate" | "declaration" | "measure";

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
  title_block_text: "Title block text",
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
  onStartCalibrate,
  onStartDeclaration,
  onStartMeasure,
  onCancelTool,
  onClearPoints,
  onApplyCalibration,
  onApplyDeclaration,
}: ScalePanelProps) {
  const hasScale = scaleInfo.scaleRatio != null || scaleInfo.pixelsPerMeter != null;
  const canMeasure =
    scaleInfo.pixelsPerMeter != null && scaleInfo.pixelsPerMeter > 0;
  const [realLength, setRealLength] = useState("");
  const [realUnit, setRealUnit] = useState<"m" | "mm">("m");
  const [scaleRatioInput, setScaleRatioInput] = useState(
    String(scaleInfo.scaleRatio ?? 200),
  );
  const [paperInput, setPaperInput] = useState(defaultPaper(scaleInfo));

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

      {(onStartCalibrate || onStartMeasure || onStartDeclaration) && (
        <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Tools
          </p>

          {toolMode === "none" && (
            <>
              <p className="text-xs leading-relaxed text-slate-600">
                Enter 1:N and paper size, or click a known length. Then measure
                to verify.
              </p>
              <div className="flex flex-col gap-2">
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
