"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  A_PAPER_SIZES_MM,
  previewPixelsPerMeterFromScalePaperDpi,
  type ScaleInfo,
} from "@/lib/scale/parseScale";
import type { PdfGraphicsKind } from "@/lib/pdf/classifyPdfGraphics";
import {
  PDF_RENDER_DPI,
  PDF_UPLOAD_DPI_MAX,
  PDF_UPLOAD_DPI_MIN,
} from "@/lib/pdf/renderPdfFirstPage";

export type ScaleToolMode = "none" | "calibrate" | "declaration" | "measure";

const DPI_PRESETS = [150, 200, 300, 400, 600, 1200] as const;

function shortGraphicsType(kind?: PdfGraphicsKind | string | null): string {
  switch (kind) {
    case "vector":
      return "Vector";
    case "raster":
      return "Raster";
    case "hybrid":
      return "Hybrid";
    case "image":
      return "Image";
    default:
      return kind ? String(kind) : "—";
  }
}

function isImageDrawing(kind?: PdfGraphicsKind | string | null): boolean {
  return kind === "image";
}

interface ScalePanelProps {
  scaleInfo: ScaleInfo;
  compact?: boolean;
  graphicsKind?: PdfGraphicsKind | string | null;
  widthPx?: number;
  heightPx?: number;
  renderDpi?: number;
  canChangeDpi?: boolean;
  dpiBusy?: boolean;
  dpiStatus?: string | null;
  dpiError?: string | null;
  onApplyDpi?: (dpi: number) => void;
  onApplyScale?: (opts: { scaleRatio: number | null; paper: string }) => void;
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{children}</p>
  );
}

function PropRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ScalePanel({
  scaleInfo,
  compact: _compact,
  graphicsKind,
  widthPx,
  heightPx,
  renderDpi = PDF_RENDER_DPI,
  canChangeDpi = false,
  dpiBusy,
  dpiStatus,
  dpiError,
  onApplyDpi,
  onApplyScale,
}: ScalePanelProps) {
  const isImage = isImageDrawing(graphicsKind);
  const defaultPaper = scaleInfo.paper ?? scaleInfo.paperFromPdf ?? "A4";
  const [draftDpi, setDraftDpi] = useState(String(renderDpi));
  const [draftRatio, setDraftRatio] = useState(
    scaleInfo.scaleRatio != null ? String(scaleInfo.scaleRatio) : "",
  );
  const [draftPaper, setDraftPaper] = useState(defaultPaper);

  useEffect(() => {
    setDraftDpi(String(renderDpi));
  }, [renderDpi]);

  useEffect(() => {
    setDraftRatio(scaleInfo.scaleRatio != null ? String(scaleInfo.scaleRatio) : "");
  }, [scaleInfo.scaleRatio]);

  useEffect(() => {
    setDraftPaper(scaleInfo.paper ?? scaleInfo.paperFromPdf ?? "A4");
  }, [scaleInfo.paper, scaleInfo.paperFromPdf]);

  const dpiOptions = useMemo(() => {
    const set = new Set<number>(DPI_PRESETS);
    if (Number.isFinite(renderDpi) && renderDpi > 0) set.add(Math.round(renderDpi));
    return Array.from(set).sort((a, b) => a - b);
  }, [renderDpi]);

  const parsedDraft = Number(draftDpi);
  const canApplyDpi =
    Boolean(onApplyDpi) &&
    !dpiBusy &&
    Number.isFinite(parsedDraft) &&
    parsedDraft >= PDF_UPLOAD_DPI_MIN &&
    parsedDraft <= PDF_UPLOAD_DPI_MAX &&
    Math.round(parsedDraft) !== Math.round(renderDpi);

  const parsedRatio = Number(draftRatio);
  const commitScale = (paperChoice = draftPaper) => {
    if (!onApplyScale) return;
    const hasRatio = Number.isFinite(parsedRatio) && parsedRatio >= 1 && parsedRatio <= 10000;
    if (draftRatio && !hasRatio) {
      setDraftRatio(scaleInfo.scaleRatio != null ? String(scaleInfo.scaleRatio) : "");
      return;
    }
    onApplyScale({
      scaleRatio: hasRatio ? Math.round(parsedRatio) : null,
      paper: paperChoice,
    });
  };

  const typeLabel = shortGraphicsType(graphicsKind);
  const paperCodes = Object.keys(A_PAPER_SIZES_MM);
  const sheetPaper =
    scaleInfo.paperFromPdf && scaleInfo.paperFromPdf in A_PAPER_SIZES_MM
      ? scaleInfo.paperFromPdf
      : draftPaper in A_PAPER_SIZES_MM
        ? draftPaper
        : null;
  const sheetLandscape =
    widthPx && heightPx
      ? widthPx >= heightPx
      : scaleInfo.pageWidthPt >= scaleInfo.pageHeightPt;
  const sheetOrientation = sheetLandscape ? "landscape" : "portrait";
  const previewPpm = useMemo(
    () =>
      previewPixelsPerMeterFromScalePaperDpi({
        scaleRatio: Number(draftRatio),
        paper: draftPaper,
        dpi: Number(draftDpi),
        renderWidthPx: widthPx,
        renderHeightPx: heightPx,
        renderDpi,
      }),
    [draftDpi, draftPaper, draftRatio, heightPx, renderDpi, widthPx],
  );
  const dpiNum = Number(draftDpi);
  const shownPpm = previewPpm ?? scaleInfo.pixelsPerMeter;
  const ppmText =
    shownPpm == null
      ? "—"
      : shownPpm >= 100
        ? Math.round(shownPpm).toLocaleString("en-US")
        : shownPpm.toFixed(1);
  const dpiText = Number.isFinite(dpiNum) && dpiNum > 0 ? ` @ ${Math.round(dpiNum)} dpi` : "";
  const dimText =
    scaleInfo.pageWidthMm && scaleInfo.pageHeightMm
      ? `${scaleInfo.pageWidthMm}×${scaleInfo.pageHeightMm} mm`
      : "—";
  const pxText = widthPx && heightPx ? `${widthPx}×${heightPx}` : "—";
  const paperText = sheetPaper ? `${sheetPaper} ${sheetOrientation}` : sheetOrientation;
  const valueClass = "min-w-0 truncate text-xs text-slate-700";

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <SectionTitle>{isImage ? "Image properties" : "PDF properties"}</SectionTitle>
        <div className="space-y-1.5 rounded-md border border-slate-200/80 bg-slate-50/60 px-2.5 py-2">
          <PropRow label="Type">
            <p className={valueClass}>{typeLabel}</p>
          </PropRow>
          <PropRow label="Paper">
            <p className={valueClass}>{paperText}</p>
          </PropRow>
          <PropRow label="Size">
            <p className={`${valueClass} tabular-nums`}>{dimText}</p>
          </PropRow>
          <PropRow label="Pixels">
            <p className={`${valueClass} tabular-nums`}>{pxText}</p>
          </PropRow>
          {!isImage ? (
            <PropRow label="DPI">
              {canChangeDpi && onApplyDpi ? (
                <div className="flex min-w-0 items-center gap-1.5">
                  <select
                    className="h-7 min-w-0 flex-1 rounded border border-slate-300 bg-white px-1 text-xs text-slate-800 disabled:opacity-50"
                    value={draftDpi}
                    disabled={dpiBusy}
                    onChange={(e) => setDraftDpi(e.target.value)}
                  >
                    {dpiOptions.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-compact-primary shrink-0 px-1.5"
                    disabled={!canApplyDpi}
                    onClick={() => onApplyDpi(Math.round(parsedDraft))}
                  >
                    {dpiBusy ? "…" : "Apply"}
                  </button>
                </div>
              ) : (
                <span className="text-xs tabular-nums text-slate-700">{Math.round(renderDpi)}</span>
              )}
            </PropRow>
          ) : null}
          {dpiStatus ? <p className="text-xs leading-snug text-slate-500">{dpiStatus}</p> : null}
          {dpiError ? <p className="text-xs leading-snug text-red-600">{dpiError}</p> : null}
        </div>
      </section>

      <section className="space-y-2">
        <SectionTitle>Scale</SectionTitle>
        <div className="space-y-2 rounded-md border border-slate-200/80 bg-slate-50/60 px-2.5 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-slate-600">1 :</span>
            <input
              type="number"
              min={1}
              max={10000}
              step={1}
              inputMode="numeric"
              placeholder="—"
              aria-label="Drawing scale 1 to N"
              className="h-7 w-16 rounded border border-slate-300 bg-white px-1.5 text-center text-xs font-medium tabular-nums text-slate-900 placeholder:text-slate-300 disabled:opacity-50"
              value={draftRatio}
              disabled={dpiBusy}
              onChange={(e) => setDraftRatio(e.target.value)}
              onBlur={() => commitScale()}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
            <span className="text-xs text-slate-400">@</span>
            <select
              aria-label="Paper size for scale"
              className="h-7 min-w-0 flex-1 rounded border border-slate-300 bg-white px-1 text-xs text-slate-800 disabled:opacity-50"
              value={draftPaper}
              disabled={dpiBusy}
              onChange={(e) => {
                const next = e.target.value;
                setDraftPaper(next);
                commitScale(next);
              }}
            >
              {paperCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs tabular-nums leading-snug text-slate-500">
            {ppmText} px/m{dpiText}
          </p>
          <p className="text-[11px] leading-snug text-slate-500">
            Use toolbar calibrate (C) or OCR tab to apply a detected scale.
          </p>
        </div>
      </section>
    </div>
  );
}
