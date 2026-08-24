"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { WorkspaceShell } from "@/components/shell/WorkspaceShell";
import { PageThumbnailStrip } from "@/features/plan-viewer/PageThumbnailStrip";
import { PdfPageViewer } from "@/features/plan-viewer/PdfPageViewer";
import { useViewerStore } from "@/features/plan-viewer/useViewerStore";
import { EditorToolbar } from "@/features/plan-editor/EditorToolbar";
import { EntityInspector } from "@/features/plan-editor/EntityInspector";
import { OverlayHotkeys } from "@/features/plan-editor/OverlayHotkeys";
import { OverlayLayerPanel } from "@/features/plan-editor/OverlayLayerPanel";
import { useOverlayStore } from "@/features/plan-editor/useOverlayStore";
import { usePageRegionDetect } from "@/features/plan-editor/usePageRegionDetect";
import { ScalePanel, type ScaleToolMode } from "@/features/scale/ScalePanel";
import { useAnalysisBundle } from "@/hooks/useProjectStore";
import { projectStore } from "@/lib/mock/store";
import { pdfGraphicsLabel } from "@/lib/pdf/classifyPdfGraphics";
import { resolvePageImagePath } from "@/lib/pdf/pageImageStore";
import {
  calibrateFromScaleAndPaper,
  calibrateFromTwoPoints,
  formatMeasuredLength,
  lengthFromPixels,
  pixelDistance,
  type PointPx,
} from "@/lib/scale/parseScale";

interface AnalysisPageClientProps {
  projectId: string;
  analysisId: string;
}

export function AnalysisPageClient({ projectId, analysisId }: AnalysisPageClientProps) {
  const router = useRouter();
  const { analysis, result, scaleInfo, ready } = useAnalysisBundle(analysisId);
  const [toolMode, setToolMode] = useState<ScaleToolMode>("none");
  const [measurePoints, setMeasurePoints] = useState<PointPx[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [inspectorTab, setInspectorTab] = useState<"scale" | "detect">("scale");
  const [pageImageUrl, setPageImageUrl] = useState<string | null>(null);
  const [pageImageError, setPageImageError] = useState<string | null>(null);
  const resetView = useViewerStore((s) => s.resetView);
  const setOverlayTool = useOverlayStore((s) => s.setTool);
  const setOverlayContext = useOverlayStore((s) => s.setContext);

  const pageCount = result?.pages.length ?? 0;
  const page = result?.pages[pageIndex];

  useEffect(() => {
    setPageIndex(0);
    setToolMode("none");
    setMeasurePoints([]);
    setInspectorTab("scale");
  }, [analysisId]);

  useEffect(() => {
    if (pageCount > 0 && pageIndex >= pageCount) {
      setPageIndex(pageCount - 1);
    }
  }, [pageCount, pageIndex]);

  useEffect(() => {
    const pageNumber = result?.pages[pageIndex]?.pageNumber ?? 1;
    setOverlayContext(analysisId, pageNumber);
  }, [analysisId, pageIndex, result?.pages, setOverlayContext]);

  const overlayTool = useOverlayStore((s) => s.tool);

  useEffect(() => {
    if (overlayTool !== "pan") {
      setToolMode("none");
      setMeasurePoints([]);
    }
  }, [overlayTool]);

  const detection = usePageRegionDetect({
    analysisId,
    pageNumber: page?.pageNumber ?? 1,
    imageUrl: pageImageUrl,
    widthPx: page?.widthPx ?? 0,
    heightPx: page?.heightPx ?? 0,
    enabled: Boolean(page && pageImageUrl && !pageImageError),
  });

  // Resolve IndexedDB / data URL → displayable object URL for the current page.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function load() {
      setPageImageError(null);
      setPageImageUrl(null);
      if (!page) return;
      try {
        const url = await resolvePageImagePath(
          page.imagePath,
          analysisId,
          page.pageNumber,
        );
        if (cancelled) {
          if (url.startsWith("blob:")) URL.revokeObjectURL(url);
          return;
        }
        if (url.startsWith("blob:")) objectUrl = url;
        setPageImageUrl(url);
      } catch (e) {
        if (!cancelled) {
          setPageImageError(
            e instanceof Error
              ? e.message
              : "Could not load page image. Re-upload the PDF.",
          );
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [analysisId, page]);

  const goToPage = useCallback(
    (index: number) => {
      if (pageCount === 0) return;
      const next = Math.min(pageCount - 1, Math.max(0, index));
      setPageIndex(next);
      setMeasurePoints([]);
      setToolMode("none");
      resetView();
    },
    [pageCount, resetView],
  );

  const handleMeasurePoint = useCallback((point: PointPx) => {
    setMeasurePoints((prev) => {
      if (prev.length >= 2) return [point];
      return [...prev, point];
    });
  }, []);

  const handleDeleteDrawing = useCallback(() => {
    if (!window.confirm(`Delete drawing “${analysis?.sourceFileName ?? "this drawing"}”?`)) {
      return;
    }
    projectStore.deleteAnalysis(analysisId);
    router.push(`/projects/${projectId}`);
  }, [analysis?.sourceFileName, analysisId, projectId, router]);

  const persistScale = useCallback(
    (next: NonNullable<typeof scaleInfo>) => {
      if (!result) return;
      projectStore.setScaleInfo(analysisId, next);
      if (next.pixelsPerMeter && next.pixelsPerMeter > 0) {
        const pages = result.pages.map((p, i) =>
          i === pageIndex
            ? {
                ...p,
                scaleMPerPixel: 1 / next.pixelsPerMeter!,
                scaleSource: next.method,
                scaleConfidence: next.confidence,
              }
            : p,
        );
        projectStore.setResult(analysisId, { ...result, pages });
      }
      setToolMode("none");
      setMeasurePoints([]);
    },
    [analysisId, result, pageIndex],
  );

  const handleApplyCalibration = useCallback(
    (opts: { realLength: number; realUnit: "m" | "mm" }) => {
      if (!scaleInfo || measurePoints.length < 2 || !result) return;
      const current = result.pages[pageIndex];
      if (!current) return;

      const next = calibrateFromTwoPoints(scaleInfo, {
        pointA: measurePoints[0],
        pointB: measurePoints[1],
        realLength: opts.realLength,
        realUnit: opts.realUnit,
      });
      persistScale(next);
    },
    [measurePoints, result, scaleInfo, pageIndex, persistScale],
  );

  const handleApplyDeclaration = useCallback(
    (opts: { scaleRatio: number; paper: string }) => {
      if (!scaleInfo || !page) return;
      const next = calibrateFromScaleAndPaper(scaleInfo, {
        scaleRatio: opts.scaleRatio,
        paper: opts.paper,
        renderWidthPx: page.widthPx,
        renderHeightPx: page.heightPx,
      });
      persistScale(next);
    },
    [scaleInfo, page, persistScale],
  );

  const measureLabel = useMemo(() => {
    if (
      toolMode !== "measure" ||
      measurePoints.length < 2 ||
      !scaleInfo?.pixelsPerMeter
    ) {
      return null;
    }
    const px = pixelDistance(measurePoints[0], measurePoints[1]);
    const { meters } = lengthFromPixels(px, scaleInfo.pixelsPerMeter);
    return formatMeasuredLength(meters);
  }, [toolMode, measurePoints, scaleInfo]);

  if (ready && !analysis) {
    return (
      <WorkspaceShell statusText="Drawing not found">
        <div className="flex h-full items-center justify-center p-8">
          <div className="text-center">
            <p className="text-slate-600">Drawing not found.</p>
            <Link href={`/projects/${projectId}`} className="btn-primary mt-4 inline-flex">
              Back to project
            </Link>
          </div>
        </div>
      </WorkspaceShell>
    );
  }

  if (!analysis) {
    return (
      <WorkspaceShell statusText="Loading…">
        <div className="flex h-full items-center justify-center text-sm text-slate-500">
          Loading drawing…
        </div>
      </WorkspaceShell>
    );
  }

  const hasLegacyReview =
    (result?.units.length ?? 0) > 0 || (result?.spaces.length ?? 0) > 0;

  const scaleLabel =
    scaleInfo?.pixelsPerMeter != null
      ? scaleInfo.scaleRatio != null
        ? `1:${scaleInfo.scaleRatio}${scaleInfo.paper ? ` @ ${scaleInfo.paper}` : ""}`
        : `${scaleInfo.pixelsPerMeter.toFixed(1)} px/m`
      : "Scale unknown";

  const graphicsLabel = page?.graphicsKind ? pdfGraphicsLabel(page.graphicsKind) : null;
  const pageStatus =
    pageCount > 0 ? `Page ${pageIndex + 1} of ${pageCount}` : "No pages";

  return (
    <WorkspaceShell
      statusText={[analysis.sourceFileName, pageStatus, graphicsLabel, scaleLabel]
        .filter(Boolean)
        .join(" · ")}
      inspectorTitle="Inspector"
      inspector={
        <div className="flex min-h-0 flex-col">
          <div className="-mx-3 -mt-3 mb-3 flex border-b border-slate-200">
            {(
              [
                ["scale", "Scale"],
                ["detect", "Detect"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={
                  inspectorTab === id
                    ? "flex-1 border-b-2 border-slate-900 px-3 py-2 text-xs font-semibold text-slate-900"
                    : "flex-1 px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-800"
                }
                onClick={() => {
                  setInspectorTab(id);
                  if (id === "detect") {
                    setToolMode("none");
                    setMeasurePoints([]);
                  }
                }}
              >
                {label}
                {id === "detect" && detection.regionCount > 0
                  ? ` (${detection.regionCount})`
                  : ""}
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {inspectorTab === "scale" ? (
              <>
                {page && (
                  <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <p className="font-medium text-slate-800">
                      {page.graphicsKind ? pdfGraphicsLabel(page.graphicsKind) : "Page raster"}
                    </p>
                    {page.graphicsSummary && (
                      <p className="mt-1 leading-relaxed text-slate-600">{page.graphicsSummary}</p>
                    )}
                    <p className="mt-1">
                      {page.widthPx} × {page.heightPx} px
                    </p>
                    <p className="mt-0.5 text-slate-500">
                      Page {page.pageNumber}
                      {pageCount > 1 ? ` of ${pageCount}` : ""} · display raster
                    </p>
                  </div>
                )}
                {scaleInfo ? (
                  <ScalePanel
                    scaleInfo={scaleInfo}
                    fileName={analysis.sourceFileName}
                    compact
                    toolMode={toolMode}
                    measurePoints={measurePoints}
                    renderWidthPx={page?.widthPx}
                    renderHeightPx={page?.heightPx}
                    graphicsKind={page?.graphicsKind}
                    graphicsSummary={page?.graphicsSummary}
                    onStartCalibrate={() => {
                      setOverlayTool("pan");
                      setToolMode("calibrate");
                      setMeasurePoints([]);
                    }}
                    onStartDeclaration={() => {
                      setOverlayTool("pan");
                      setToolMode("declaration");
                      setMeasurePoints([]);
                    }}
                    onStartMeasure={() => {
                      setOverlayTool("pan");
                      setToolMode("measure");
                      setMeasurePoints([]);
                    }}
                    onCancelTool={() => {
                      setToolMode("none");
                      setMeasurePoints([]);
                    }}
                    onClearPoints={() => setMeasurePoints([])}
                    onApplyCalibration={handleApplyCalibration}
                    onApplyDeclaration={handleApplyDeclaration}
                  />
                ) : (
                  <p className="text-sm text-slate-500">No scale data available.</p>
                )}
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <button
                    type="button"
                    className="w-full rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                    disabled={detection.detecting}
                    onClick={() => void detection.runDetect()}
                  >
                    {detection.detecting ? "Detecting…" : "Detect regions"}
                  </button>
                  <p
                    className={
                      detection.detectError
                        ? "text-[11px] leading-relaxed text-red-600"
                        : "text-[11px] leading-relaxed text-slate-500"
                    }
                  >
                    {detection.detectError
                      ? detection.detectError
                      : detection.detecting
                        ? "Running detection…"
                        : detection.regionCount > 0
                          ? `${detection.regionCount} regions · ${detection.modelLabel ?? "detector"}`
                          : (detection.detectWarning ??
                            "Detects walls and fixtures on the page.")}
                  </p>
                </div>
                <OverlayLayerPanel />
                <EntityInspector />
              </>
            )}
            <button
              type="button"
              className="w-full rounded border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
              onClick={handleDeleteDrawing}
            >
              Delete drawing
            </button>
          </div>
        </div>
      }
    >
      <div className="flex h-full min-h-0 flex-col bg-white">
        <OverlayHotkeys enabled={toolMode === "none"} />
        <EditorToolbar />
        {result && result.pages.length > 0 && (
          <PageThumbnailStrip
            analysisId={analysisId}
            pages={result.pages}
            activeIndex={pageIndex}
            onSelect={goToPage}
          />
        )}

        {hasLegacyReview && (
          <div className="shrink-0 border-b border-slate-200 px-3 py-2">
            <Link
              href={`/projects/${projectId}/analyses/${analysisId}/review`}
              className="text-xs text-brand-600 hover:underline"
            >
              Open legacy review viewer →
            </Link>
          </div>
        )}

        {pageImageError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-slate-600">
            <p>{pageImageError}</p>
            <p className="text-xs text-slate-500">
              Older uploads may be missing page images. Re-upload the PDF to restore pages at 300
              DPI.
            </p>
            <Link href={`/projects/${projectId}`} className="btn-primary mt-2 text-xs">
              Back to project & upload
            </Link>
          </div>
        ) : page && pageImageUrl ? (
          <PdfPageViewer
            key={`${page.id}-${pageImageUrl.slice(0, 48)}`}
            imagePath={pageImageUrl}
            widthPx={page.widthPx}
            heightPx={page.heightPx}
            toolMode={toolMode === "declaration" ? "none" : toolMode}
            measurePoints={measurePoints}
            measureLabel={measureLabel}
            onMeasurePoint={handleMeasurePoint}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
            {page ? "Loading page image…" : "No rendered page available."}
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}
