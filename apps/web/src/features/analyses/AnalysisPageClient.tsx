"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VerticalInspectorTabs } from "@/components/shell/VerticalInspectorTabs";
import { WorkspaceShell } from "@/components/shell/WorkspaceShell";
import { PageThumbnailStrip } from "@/features/plan-viewer/PageThumbnailStrip";
import { PdfPageViewer } from "@/features/plan-viewer/PdfPageViewer";
import { useViewerStore } from "@/features/plan-viewer/useViewerStore";
import { EditorToolbar } from "@/features/plan-editor/EditorToolbar";
import { EntityInspector } from "@/features/plan-editor/EntityInspector";
import { DetectModelSelect } from "@/features/plan-editor/DetectModelSelect";
import { ManualLayoutPanel } from "@/features/plan-editor/ManualLayoutPanel";
import { LayoutRegionInspector } from "@/features/plan-editor/LayoutRegionInspector";
import { OverlayHotkeys } from "@/features/plan-editor/OverlayHotkeys";
import { OverlayLayerPanel } from "@/features/plan-editor/OverlayLayerPanel";
import { HierarchyPanel } from "@/features/analyses/HierarchyPanel";
import { OcrPanel } from "@/features/ocr/OcrPanel";
import { useOcrSettingsStore } from "@/features/ocr/useOcrSettingsStore";
import { pageKey, useOverlayStore } from "@/features/plan-editor/useOverlayStore";
import { usePageRegionDetect } from "@/features/plan-editor/usePageRegionDetect";
import { geometryBBox } from "@/features/plan-editor/types";
import { ScalePanel, type ScaleToolMode } from "@/features/scale/ScalePanel";
import { useAnalysisBundle, useProject } from "@/hooks/useProjectStore";
import { requestPolicyAnalyze } from "@/lib/api/policyClient";
import {
  ocrPageImageStream,
  OcrStreamCancelled,
  type SheetOcrMeta,
} from "@/lib/api/ocrClient";
import { projectStore } from "@/lib/data/projectStore";
import { buildHierarchyFromOverlays } from "@/lib/hierarchy/buildHierarchy";
import {
  applyOcrLevelToPage,
  pickLevelFromOcrMeta,
  pickUnitIdsFromOcrMeta,
  resolveBuildingName,
  resolveFloorPageMeta,
} from "@/lib/hierarchy/pageLevel";
import { pdfGraphicsLabel } from "@/lib/pdf/classifyPdfGraphics";
import { putPageImageBlob, resolvePageImagePath } from "@/lib/pdf/pageImageStore";
import { PDF_RENDER_DPI } from "@/lib/pdf/renderPdfFirstPage";
import { rotateOverlayEntity, type PageRotationDeg } from "@/lib/pdf/pageRotation";
import { rotateImageBlob } from "@/lib/pdf/rotateRaster";
import { uploadPlanObject } from "@/lib/supabase/plans";
import {
  calibrateFromScaleAndPaper,
  calibrateFromTwoPoints,
  canonicalScaleText,
  formatMeasuredLength,
  lengthFromPixels,
  parseScaleAndPaper,
  pixelDistance,
  type PointPx,
} from "@/lib/scale/parseScale";
import {
  applyScaleFromOcrText,
  cropImageBlob,
  findDrawingAreaCrop,
  findTitleBlockCrop,
  findTitleBlockRegion,
  findDrawingAreaRegion,
  formatLayoutRegionSummary,
  layoutCropToPageRect,
  mapCropTileToPage,
  ocrScaleTextForPage,
  remapOcrLinesToLayoutRegion,
  shouldApplyOcrScale,
} from "@/lib/scale/layoutRegionCrop";

type InspectorTabId = "layout" | "ocr" | "scale" | "detect" | "hierarchy";

const EMPTY_SELECTED_IDS: string[] = [];

function PageInfoCard({
  page,
  pageCount,
  levelName,
}: {
  page: {
    graphicsKind?: string | null;
    graphicsSummary?: string | null;
    widthPx: number;
    heightPx: number;
    pageNumber: number;
    levelName?: string | null;
  };
  pageCount: number;
  levelName?: string | null;
}) {
  return (
    <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <p className="font-medium text-slate-800">
        {page.graphicsKind ? pdfGraphicsLabel(page.graphicsKind) : "Page raster"}
      </p>
      {page.graphicsSummary ? (
        <p className="mt-1 leading-relaxed text-slate-600">{page.graphicsSummary}</p>
      ) : null}
      <p className="mt-1">
        {page.widthPx} × {page.heightPx} px
      </p>
      <p className="mt-0.5 text-slate-500">
        Page {page.pageNumber}
        {pageCount > 1 ? ` of ${pageCount}` : ""} · {levelName ?? page.levelName ?? `Floor ${page.pageNumber}`}
      </p>
    </div>
  );
}

function ocrProgressPercent(progress: {
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

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof Error && e.name === "AbortError") || e instanceof OcrStreamCancelled
  );
}

function ocrLinesToHighlights(meta: SheetOcrMeta | null | undefined) {
  const lines = meta?.lines ?? [];
  return lines
    .filter((l) => Array.isArray(l.bbox) && l.bbox.length >= 2 && l.text?.trim())
    .map((l) => {
      const pts = l.bbox as [number, number][];
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      const x1 = Math.max(...xs);
      const y1 = Math.max(...ys);
      return {
        x: x0,
        y: y0,
        width: x1 - x0,
        height: y1 - y0,
        text: l.text.trim(),
        confidence: l.confidence ?? 0,
      };
    });
}

function OcrLinesPreview({ meta, emptyLabel }: { meta: SheetOcrMeta | null | undefined; emptyLabel: string }) {
  const lines = (meta?.lines ?? []).filter((l) => l.text?.trim());
  if (!lines.length) {
    return <p className="text-[11px] leading-relaxed text-slate-500">{emptyLabel}</p>;
  }
  return (
    <ul className="max-h-40 space-y-1 overflow-y-auto rounded border border-slate-100 bg-slate-50/80 p-2 text-[11px] leading-snug text-slate-700">
      {lines.map((line, idx) => (
        <li key={`${line.text}-${idx}`} className="flex gap-2">
          <span className="shrink-0 tabular-nums text-slate-400">
            {Math.round((line.confidence ?? 0) * 100)}%
          </span>
          <span className="min-w-0 break-words">{line.text.trim()}</span>
        </li>
      ))}
    </ul>
  );
}

function normalizePageOcrMeta(sheet: SheetOcrMeta) {
  const scaleText = canonicalScaleText(sheet.scaleText, sheet.paperSize, sheet.lines);
  const decl = scaleText ? parseScaleAndPaper(scaleText) : null;
  const base = {
    sheetType: sheet.sheetType,
    title: sheet.title ?? null,
    scaleText,
    paperSize: decl?.paper ?? sheet.paperSize ?? null,
    north: sheet.north ?? null,
    levelName: sheet.levelName ?? null,
    unitIds: sheet.unitIds ?? [],
    warnings: sheet.warnings ?? [],
    provider: sheet.provider,
    confidence: sheet.confidence,
    ocrLineCount: sheet.ocrLineCount ?? sheet.lines?.length ?? 0,
    textHint: sheet.textHint,
    lines: sheet.lines ?? [],
    tiling: sheet.tiling,
  };
  return {
    ...base,
    levelName: pickLevelFromOcrMeta(base) ?? base.levelName ?? null,
    unitIds: pickUnitIdsFromOcrMeta(base),
  };
}

interface AnalysisPageClientProps {
  projectId: string;
  analysisId: string;
}

export function AnalysisPageClient({ projectId, analysisId }: AnalysisPageClientProps) {
  const router = useRouter();
  const { analysis, result, scaleInfo, ready } = useAnalysisBundle(analysisId);
  const { project } = useProject(projectId);
  const [toolMode, setToolMode] = useState<ScaleToolMode>("none");
  const [measurePoints, setMeasurePoints] = useState<PointPx[]>([]);
  const [inspectorTab, setInspectorTab] = useState<InspectorTabId>("layout");
  const [pageImageUrl, setPageImageUrl] = useState<string | null>(null);
  const [pageImageError, setPageImageError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [rotateStatus, setRotateStatus] = useState<string | null>(null);
  const [deletingPageNumber, setDeletingPageNumber] = useState<number | null>(null);
  const [pageDeleteError, setPageDeleteError] = useState<string | null>(null);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrKind, setOcrKind] = useState<"title_block" | "drawing" | "both" | null>(null);
  const [titleBlockOcrError, setTitleBlockOcrError] = useState<string | null>(null);
  const [drawingOcrError, setDrawingOcrError] = useState<string | null>(null);
  const [ocrStatus, setOcrStatus] = useState<string | null>(null);
  const [ocrProgress, setOcrProgress] = useState<{
    current: number;
    total: number;
    pageNumber: number;
    phase: "prepare" | "ocr" | "save";
  } | null>(null);
  const [ocrOverlay, setOcrOverlay] = useState<{
    pageNumber: number;
    region: { x: number; y: number; width: number; height: number };
    tile: { x: number; y: number; width: number; height: number } | null;
    label: string;
  } | null>(null);
  const [titleBlockOcrNotice, setTitleBlockOcrNotice] = useState<string | null>(null);
  const [drawingOcrNotice, setDrawingOcrNotice] = useState<string | null>(null);
  const [autoScaleOcr, setAutoScaleOcr] = useState(true);
  const ocrAbortRef = useRef<AbortController | null>(null);
  const autoScaleOcrAttemptedRef = useRef(new Set<string>());
  const appliedOcrScaleKeyRef = useRef<string | null>(null);
  const policyAbortRef = useRef<AbortController | null>(null);
  const resetView = useViewerStore((s) => s.resetView);
  const pageIndex = useViewerStore((s) => s.pageIndex);
  const setPageIndex = useViewerStore((s) => s.setPageIndex);
  const setOverlayTool = useOverlayStore((s) => s.setTool);
  const setLayoutDrawType = useOverlayStore((s) => s.setLayoutDrawType);
  const setOverlayContext = useOverlayStore((s) => s.setContext);
  const selectOverlay = useOverlayStore((s) => s.select);
  const selectedIds = useOverlayStore((s) => {
    const key = pageKey(analysisId, result?.pages[pageIndex]?.pageNumber ?? 1);
    return s.pages[key]?.selectedIds ?? EMPTY_SELECTED_IDS;
  });
  const overlayPages = useOverlayStore((s) => s.pages);
  const pageCount = result?.pages.length ?? 0;
  const page = result?.pages[pageIndex];
  const pageNumber = page?.pageNumber ?? 1;
  const pageOcr = page?.ocrMeta;
  const layoutOcrScaleText = useMemo(() => ocrScaleTextForPage(page), [page]);
  const effectiveOcrScaleText = useMemo(() => {
    return (
      layoutOcrScaleText ||
      (page?.ocrMeta?.lines?.length ? canonicalScaleText(null, null, page.ocrMeta.lines) : null)
    );
  }, [layoutOcrScaleText, page?.ocrMeta?.lines]);
  const pageDrawingOcr = page?.drawingOcrMeta;
  const titleBlockRegion = useMemo(() => {
    if (!page) return null;
    return findTitleBlockRegion(analysisId, page.pageNumber, page.widthPx, page.heightPx);
  }, [analysisId, overlayPages, page]);
  const drawingAreaRegion = useMemo(() => {
    if (!page) return null;
    return findDrawingAreaRegion(analysisId, page.pageNumber, page.widthPx, page.heightPx);
  }, [analysisId, overlayPages, page]);

  const resolvedPageLevel = useMemo(
    () => (page && result ? resolveFloorPageMeta(page, result.sourceFileName) : null),
    [page, result],
  );
  const titleBlockHighlights = useMemo(() => ocrLinesToHighlights(pageOcr), [pageOcr]);
  const drawingHighlights = useMemo(() => ocrLinesToHighlights(pageDrawingOcr), [pageDrawingOcr]);
  const ocrHighlights = useMemo(
    () => [...drawingHighlights, ...titleBlockHighlights],
    [drawingHighlights, titleBlockHighlights],
  );
  const hasOcrOnAnyPage = useMemo(
    () =>
      Boolean(
        result?.pages.some(
          (p) =>
            (p.ocrMeta?.lines?.length ?? 0) > 0 || (p.drawingOcrMeta?.lines?.length ?? 0) > 0,
        ),
      ),
    [result?.pages],
  );

  const liveHierarchy = useMemo(() => {
    if (!result?.pages.length) return result?.hierarchy ?? null;
    const pageMetas = result.pages.map((p) =>
      resolveFloorPageMeta(p, result.sourceFileName),
    );
    const entitiesByPage: Record<number, import("@/features/plan-editor/types").OverlayEntity[]> = {};
    for (const p of result.pages) {
      const key = pageKey(analysisId, p.pageNumber);
      entitiesByPage[p.pageNumber] = overlayPages[key]?.entities ?? [];
    }
    return buildHierarchyFromOverlays({
      analysisId,
      projectId,
      buildingName: resolveBuildingName({
        projectName: project?.name,
        pages: result.pages,
        sourceFileName: analysis?.sourceFileName ?? result.sourceFileName,
      }),
      pages: pageMetas,
      entitiesByPage,
    });
  }, [
    analysis?.sourceFileName,
    analysisId,
    overlayPages,
    project?.name,
    projectId,
    result,
  ]);

  useEffect(() => {
    if (inspectorTab === "layout" && toolMode === "none") {
      setOverlayTool("select");
    }
  }, [inspectorTab, toolMode, setOverlayTool]);

  useEffect(() => {
    setPageIndex(0);
    setToolMode("none");
    setMeasurePoints([]);
    setInspectorTab("scale");
    setOverlayTool("pan");
    useOverlayStore.getState().clearSelection();
    autoScaleOcrAttemptedRef.current.clear();
    appliedOcrScaleKeyRef.current = null;
  }, [analysisId, setPageIndex, setOverlayTool]);

  useEffect(() => {
    autoScaleOcrAttemptedRef.current.delete(`${analysisId}:${pageNumber}`);
  }, [analysisId, pageNumber, titleBlockRegion?.widthPx, titleBlockRegion?.heightPx]);

  useEffect(() => {
    if (pageCount > 0 && pageIndex >= pageCount) {
      setPageIndex(pageCount - 1);
    }
  }, [pageCount, pageIndex, setPageIndex]);

  useEffect(() => {
    const pageNumber = result?.pages[pageIndex]?.pageNumber ?? 1;
    setOverlayContext(analysisId, pageNumber);
  }, [analysisId, pageIndex, result?.pages, setOverlayContext]);

  useEffect(() => {
    setToolMode("none");
    setMeasurePoints([]);
  }, [pageIndex]);

  useEffect(() => {
    if (!ready) return;
    const overlays = projectStore.getOverlays(analysisId);
    if (!overlays) return;
    for (const [page, entities] of Object.entries(overlays)) {
      const pageNumber = Number(page);
      if (!Number.isFinite(pageNumber) || entities.length === 0) continue;
      useOverlayStore.getState().loadPageEntities(entities, { analysisId, pageNumber });
    }
  }, [analysisId, ready]);

  useEffect(() => {
    return () => {
      ocrAbortRef.current?.abort();
      policyAbortRef.current?.abort();
    };
  }, []);

  const overlayTool = useOverlayStore((s) => s.tool);

  useEffect(() => {
    if (overlayTool !== "pan") {
      setToolMode("none");
      setMeasurePoints([]);
    }
  }, [overlayTool]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const key = pageKey(analysisId, pageNumber);
    const unsub = useOverlayStore.subscribe((state, prev) => {
      if (state.pages[key] === prev.pages[key]) return;
      const prevEntities = prev.pages[key]?.entities;
      const nextEntities = state.pages[key]?.entities ?? [];
      if (prevEntities === undefined && nextEntities.length === 0) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const entities = useOverlayStore.getState().pages[key]?.entities ?? [];
        void projectStore.setOverlays(analysisId, pageNumber, entities);
      }, 700);
    });
    return () => {
      unsub();
      if (timer) {
        clearTimeout(timer);
        const entities = useOverlayStore.getState().pages[key]?.entities ?? [];
        void projectStore.setOverlays(analysisId, pageNumber, entities);
      }
    };
  }, [analysisId, pageNumber]);

  const detection = usePageRegionDetect({
    analysisId,
    pageNumber: page?.pageNumber ?? 1,
    imageUrl: pageImageUrl,
    widthPx: page?.widthPx ?? 0,
    heightPx: page?.heightPx ?? 0,
    enabled: Boolean(page && pageImageUrl && !pageImageError),
    graphicsKind: page?.graphicsKind,
    sourceFileName: analysis?.sourceFileName,
    sourceStoragePath: analysis?.storagePath,
    allPages:
      result?.pages.map((p) => ({
        pageNumber: p.pageNumber,
        widthPx: p.widthPx,
        heightPx: p.heightPx,
        imagePath: p.imagePath,
      })) ?? [],
  });

  const runPolicyCheck = useCallback(async () => {
    if (!page) return;
    policyAbortRef.current?.abort();
    const ac = new AbortController();
    policyAbortRef.current = ac;
    setPolicyBusy(true);
    setPolicyError(null);
    try {
      const key = pageKey(analysisId, page.pageNumber);
      const entities =
        useOverlayStore.getState().pages[key]?.entities.filter((e) => e.source === "model") ?? [];
      const regions = entities
        .filter((e) => e.status !== "rejected")
        .map((e) => {
          const bbox = geometryBBox(e.geometry);
          const g = e.geometry;
          const polygonPx =
            g.kind === "polygon" || g.kind === "mask"
              ? g.points
              : g.kind === "rect"
                ? [
                    { x: g.x, y: g.y },
                    { x: g.x + g.width, y: g.y },
                    { x: g.x + g.width, y: g.y + g.height },
                    { x: g.x, y: g.y + g.height },
                  ]
                : g.kind === "polyline"
                  ? g.points
                  : bbox
                    ? [
                        { x: bbox.x, y: bbox.y },
                        { x: bbox.x + bbox.width, y: bbox.y },
                        { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
                        { x: bbox.x, y: bbox.y + bbox.height },
                      ]
                    : [];
          return {
            id: e.id,
            type: e.type,
            label: e.label,
            confidence: e.confidence,
            polygonPx,
            bboxPx: bbox ?? { x: 0, y: 0, width: 0, height: 0 },
            attributes: e.attributes,
          };
        });
      const statuses: Record<string, string> = {};
      for (const e of entities) statuses[e.id] = e.status;
      const ppm = scaleInfo?.pixelsPerMeter;
      const mmPerPixel = ppm && ppm > 0 ? 1000 / ppm : null;
      const { result: next } = await requestPolicyAnalyze(
        {
          analysis_id: analysisId,
          project_id: projectId,
          source_file_name: analysis?.sourceFileName ?? "plan.pdf",
          mm_per_pixel: mmPerPixel,
          calibration_verified: Boolean(scaleInfo?.pixelsPerMeter),
          width_px: page.widthPx,
          height_px: page.heightPx,
          model_id: detection.modelLabel?.split(" ")[0] ?? "overlays",
          entity_statuses: statuses,
          policy_version: project?.policyVersion ?? "highlife_v1",
          regions,
        },
        ac.signal,
      );
      if (ac.signal.aborted) return;
      await projectStore.setResult(analysisId, next);
    } catch (e) {
      if (isAbortError(e) || ac.signal.aborted) return;
      const message = e instanceof Error ? e.message : "Policy check failed";
      setPolicyError(
        message.includes("Failed to fetch")
          ? "Inference API is not running on :8000."
          : message,
      );
    } finally {
      if (policyAbortRef.current === ac) policyAbortRef.current = null;
      setPolicyBusy(false);
    }
  }, [
    analysis?.sourceFileName,
    analysisId,
    detection.modelLabel,
    page,
    project?.policyVersion,
    projectId,
    scaleInfo?.pixelsPerMeter,
  ]);

  // Resolve IndexedDB / data URL → displayable object URL for the current page.
  const pageImagePath = page?.imagePath;
  const pageImageNumber = page?.pageNumber;
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function load() {
      setPageImageError(null);
      setPageImageUrl(null);
      if (!pageImagePath || pageImageNumber == null) return;
      try {
        const url = await resolvePageImagePath(pageImagePath, analysisId, pageImageNumber);
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
  }, [analysisId, pageImagePath, pageImageNumber]);

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
    void projectStore.deleteAnalysis(analysisId).then(() => {
      router.push(`/projects/${projectId}`);
    });
  }, [analysis?.sourceFileName, analysisId, projectId, router]);

  const handleDeletePage = useCallback(
    async (target: { pageNumber: number }) => {
      if (!result || result.pages.length <= 1) return;
      if (
        !window.confirm(
          `Delete page ${target.pageNumber} from this drawing? Overlays and OCR for that page will be removed.`,
        )
      ) {
        return;
      }
      setPageDeleteError(null);
      setDeletingPageNumber(target.pageNumber);
      try {
        const deletedIndex = result.pages.findIndex((p) => p.pageNumber === target.pageNumber);
        await projectStore.deleteAnalysisPage(analysisId, target.pageNumber);
        useOverlayStore.getState().removePage(analysisId, target.pageNumber);
        const nextCount = result.pages.length - 1;
        if (deletedIndex >= 0) {
          let nextIndex = pageIndex;
          if (deletedIndex < pageIndex) nextIndex = pageIndex - 1;
          else if (deletedIndex === pageIndex) nextIndex = Math.min(pageIndex, nextCount - 1);
          setPageIndex(Math.max(0, nextIndex));
        }
        setPageImageUrl(null);
      } catch (e) {
        setPageDeleteError(e instanceof Error ? e.message : "Could not delete page.");
      } finally {
        setDeletingPageNumber(null);
      }
    },
    [analysisId, pageIndex, result, setPageIndex],
  );

  const persistScale = useCallback(
    (
      next: NonNullable<typeof scaleInfo>,
      targetPageNumber?: number,
      opts?: { applyAllPages?: boolean },
    ) => {
      const liveResult = projectStore.getResult(analysisId) ?? result;
      const liveScale = projectStore.getScaleInfo(analysisId);
      if (!liveResult) {
        void projectStore.setScaleInfo(analysisId, next);
        setToolMode("none");
        setMeasurePoints([]);
        return;
      }
      if (next.pixelsPerMeter && next.pixelsPerMeter > 0) {
        const pageNum = targetPageNumber ?? (liveResult.pages[pageIndex]?.pageNumber ?? 1);
        const mPerPx = 1 / next.pixelsPerMeter;
        const pagesUnchanged = liveResult.pages.every((p) => {
          const shouldUpdate = opts?.applyAllPages ? true : p.pageNumber === pageNum;
          if (!shouldUpdate) return true;
          return (
            p.scaleMPerPixel === mPerPx &&
            p.scaleSource === next.method &&
            p.scaleConfidence === next.confidence
          );
        });
        const scaleUnchanged =
          liveScale?.pixelsPerMeter === next.pixelsPerMeter &&
          liveScale?.method === next.method &&
          liveScale?.scaleRatio === next.scaleRatio &&
          liveScale?.paper === next.paper;
        if (pagesUnchanged && scaleUnchanged) {
          setToolMode("none");
          setMeasurePoints([]);
          return;
        }
        const pages = liveResult.pages.map((p) => {
          const shouldUpdate = opts?.applyAllPages ? true : p.pageNumber === pageNum;
          return shouldUpdate
            ? {
                ...p,
                scaleMPerPixel: mPerPx,
                scaleSource: next.method,
                scaleConfidence: next.confidence,
              }
            : p;
        });
        void projectStore.setResult(analysisId, { ...liveResult, pages });
      }
      void projectStore.setScaleInfo(analysisId, next);
      setToolMode("none");
      setMeasurePoints([]);
    },
    [analysisId, pageIndex, result],
  );

  const handleApplyCalibration = useCallback(
    (opts: { realLength: number; realUnit: "m" | "mm" }) => {
      const liveScale = projectStore.getScaleInfo(analysisId) ?? scaleInfo;
      if (!liveScale || measurePoints.length < 2) return;
      const liveResult = projectStore.getResult(analysisId) ?? result;
      const current = liveResult?.pages[pageIndex] ?? page;
      if (!current) return;

      const next = calibrateFromTwoPoints(liveScale, {
        pointA: measurePoints[0],
        pointB: measurePoints[1],
        realLength: opts.realLength,
        realUnit: opts.realUnit,
      });
      persistScale(next, current.pageNumber, { applyAllPages: true });
    },
    [analysisId, measurePoints, page, pageIndex, persistScale, result, scaleInfo],
  );

  const handleApplyDeclaration = useCallback(
    (opts: { scaleRatio: number; paper: string }) => {
      const liveScale = projectStore.getScaleInfo(analysisId) ?? scaleInfo;
      const liveResult = projectStore.getResult(analysisId) ?? result;
      const currentPage = liveResult?.pages[pageIndex] ?? page;
      if (!liveScale || !currentPage) return;
      const next = calibrateFromScaleAndPaper(liveScale, {
        scaleRatio: opts.scaleRatio,
        paper: opts.paper,
        renderWidthPx: currentPage.widthPx,
        renderHeightPx: currentPage.heightPx,
      });
      persistScale(next, currentPage.pageNumber, { applyAllPages: true });
    },
    [analysisId, page, pageIndex, persistScale, result, scaleInfo],
  );

  const handleApplyOcrScale = useCallback(
    (
      opts: { scaleRatio: number; paper: string },
      targetPage?: { pageNumber: number; widthPx: number; heightPx: number; ocrMeta?: typeof pageOcr },
    ) => {
      const liveScale = projectStore.getScaleInfo(analysisId) ?? scaleInfo;
      const currentPage = targetPage ?? page;
      if (!currentPage) return;
      const paperCode = opts.paper.toUpperCase().trim();
      const baseScale: ScaleInfo = liveScale ?? {
        scaleRatio: opts.scaleRatio,
        paper: paperCode,
        paperFromPdf: paperCode,
        pageWidthPt: currentPage.widthPx,
        pageHeightPt: currentPage.heightPx,
        pageWidthMm: A_PAPER_SIZES_MM[paperCode]?.[0] ?? 297,
        pageHeightMm: A_PAPER_SIZES_MM[paperCode]?.[1] ?? 420,
        method: "auto_detect_scale",
        confidence: 0.95,
        pixelsPerMeter: null,
        scaleLabel: `1:${opts.scaleRatio} @ ${paperCode}`,
      };

      const next = calibrateFromScaleAndPaper(baseScale, {
        scaleRatio: opts.scaleRatio,
        paper: paperCode,
        renderWidthPx: currentPage.widthPx,
        renderHeightPx: currentPage.heightPx,
      });

      persistScale(
        {
          ...next,
          method: "auto_detect_scale",
          confidence: Math.max(next.confidence, currentPage.ocrMeta?.confidence ?? 0.85),
          scaleLabel: `1:${opts.scaleRatio} @ ${paperCode}`,
        },
        currentPage.pageNumber,
        { applyAllPages: true },
      );
    },
    [analysisId, page, persistScale, scaleInfo],
  );

  const tryApplyOcrScaleForPage = useCallback(
    (
      targetPage: { pageNumber: number; widthPx: number; heightPx: number; ocrMeta?: typeof pageOcr },
      liveScale = projectStore.getScaleInfo(analysisId) ?? scaleInfo,
    ) => {
      const scaleText = ocrScaleTextForPage(targetPage);
      if (!scaleText) return false;
      return applyScaleFromOcrText(scaleText, liveScale, targetPage, (opts) =>
        handleApplyOcrScale(opts, targetPage),
      );
    },
    [analysisId, handleApplyOcrScale, scaleInfo],
  );

  const cancelOcr = useCallback(() => {
    ocrAbortRef.current?.abort();
  }, []);

  const cancelPolicyCheck = useCallback(() => {
    policyAbortRef.current?.abort();
  }, []);

  const runLayoutRegionOcr = useCallback(
    async (
      kind: "title_block" | "drawing" | "page" | "both",
      opts?: { targetPages?: number[]; applyScale?: boolean },
    ) => {
      const liveResult = projectStore.getResult(analysisId) ?? result;
      if (!liveResult) return;

      const kindsToRun: ("title_block" | "drawing" | "page")[] =
        kind === "both" ? ["title_block", "drawing"] : [kind];

      const findCropFor = (k: "title_block" | "drawing" | "page") =>
        k === "title_block"
          ? (p: (typeof liveResult.pages)[number]) =>
              findTitleBlockCrop(analysisId, p.pageNumber, p.widthPx, p.heightPx) ?? {
                x: 0.5,
                y: 0.55,
                width: 0.5,
                height: 0.45,
              }
          : k === "drawing"
            ? (p: (typeof liveResult.pages)[number]) =>
                findDrawingAreaCrop(analysisId, p.pageNumber, p.widthPx, p.heightPx)
            : () => ({
                x: 0,
                y: 0,
                width: 1,
                height: 1,
              });

      const pagesForKind = (k: "title_block" | "drawing" | "page") =>
        liveResult.pages.filter((p) => {
          if (opts?.targetPages?.length && !opts.targetPages.includes(p.pageNumber)) return false;
          return Boolean(findCropFor(k)(p));
        });

      const work = kindsToRun
        .map((k) => ({ kind: k, pages: pagesForKind(k) }))
        .filter((item) => item.pages.length > 0);

      if (!work.length) {
        if (kind === "both") {
          const titleMissing = pagesForKind("title_block").length === 0;
          const drawingMissing = pagesForKind("drawing").length === 0;
          if (titleMissing) {
            setTitleBlockOcrError(
              "No title block set on any page. Draw one manually or run layout detection.",
            );
          }
          if (drawingMissing) {
            setDrawingOcrError(
              "No drawing area set on any page. Draw one manually or run layout detection.",
            );
          }
        } else {
          const regionLabel =
            kind === "title_block"
              ? "title block"
              : kind === "page"
                ? "page"
                : "drawing area";
          const msg = `No ${regionLabel} set. Draw one manually or run layout detection.`;
          if (kind === "title_block") setTitleBlockOcrError(msg);
          else setDrawingOcrError(msg);
        }
        return;
      }

      if (kind === "both") {
        if (pagesForKind("title_block").length === 0) {
          setTitleBlockOcrNotice("Skipped title block — no regions on any page.");
        }
        if (pagesForKind("drawing").length === 0) {
          setDrawingOcrNotice("Skipped drawing area — no regions on any page.");
        }
      }

      ocrAbortRef.current?.abort();
      const ac = new AbortController();
      ocrAbortRef.current = ac;
      setOcrKind(kind);
      setOcrBusy(true);
      if (kind === "title_block" || kind === "page" || kind === "both") {
        setTitleBlockOcrError(null);
        setTitleBlockOcrNotice(null);
      }
      if (kind === "drawing" || kind === "both") {
        setDrawingOcrError(null);
        setDrawingOcrNotice(null);
      }
      setOcrProgress(null);
      setOcrStatus(
        kind === "both"
          ? "Preparing OCR for all pages…"
          : `Preparing ${
              work[0].kind === "title_block"
                ? "title block"
                : work[0].kind === "page"
                  ? "page"
                  : "drawing area"
            } OCR…`,
      );

      const totalSteps = work.reduce((sum, item) => sum + item.pages.length, 0);
      let step = 0;
      let latestPages = liveResult.pages;

      try {
        for (const { kind: runKind, pages: pagesWithCrop } of work) {
          const findCrop = findCropFor(runKind);
          const regionLabel =
            runKind === "title_block"
              ? "title block"
              : runKind === "page"
                ? "page"
                : "drawing area";
          const ocrByPage = new Map<number, ReturnType<typeof normalizePageOcrMeta>>();

          for (const p of pagesWithCrop) {
            if (ac.signal.aborted) break;
            step += 1;
            const crop = findCrop(p);
            if (!crop) continue;

            setOcrProgress({
              current: step,
              total: totalSteps,
              pageNumber: p.pageNumber,
              phase: "prepare",
            });
            setOcrStatus(
              kind === "both"
                ? `Page ${p.pageNumber} (${step}/${totalSteps}): ${regionLabel} — loading…`
                : `Page ${p.pageNumber} (${step}/${totalSteps}): loading page image…`,
            );
            const url = await resolvePageImagePath(p.imagePath, analysisId, p.pageNumber);
            const res = await fetch(url, { signal: ac.signal });
            if (!res.ok) throw new Error(`Could not load page ${p.pageNumber} image for OCR.`);
            const blob = await res.blob();
            const cropped = await cropImageBlob(blob, crop);
            const region = layoutCropToPageRect(crop, p.widthPx, p.heightPx);
            const cropRaster = await createImageBitmap(cropped);
            let cropWidthPx = cropRaster.width;
            let cropHeightPx = cropRaster.height;
            cropRaster.close();
            setOcrOverlay({
              pageNumber: p.pageNumber,
              region,
              tile: region,
              label: `OCR ${regionLabel}…`,
            });
            setOcrProgress({
              current: step,
              total: totalSteps,
              pageNumber: p.pageNumber,
              phase: "ocr",
            });
            setOcrStatus(
              kind === "both"
                ? `Page ${p.pageNumber} (${step}/${totalSteps}): ${regionLabel} OCR…`
                : `Page ${p.pageNumber} (${step}/${totalSteps}): OCR ${regionLabel}…`,
            );
            const out = await ocrPageImageStream(
              cropped,
              `page-${p.pageNumber}-${runKind}.png`,
              {
                signal: ac.signal,
                profile: runKind === "drawing" ? "dense" : "default",
                ocrOptions: useOcrSettingsStore.getState().getOcrOptions(),
              },
              {
                onMeta: (meta) => {
                  if (meta.width > 0 && meta.height > 0) {
                    cropWidthPx = meta.width;
                    cropHeightPx = meta.height;
                  }
                },
                onStatus: (message) => {
                  setOcrStatus(
                    kind === "both"
                      ? `Page ${p.pageNumber} (${step}/${totalSteps}): ${regionLabel} — ${message}`
                      : `Page ${p.pageNumber} (${step}/${totalSteps}): ${message}`,
                  );
                  setOcrOverlay((prev) =>
                    prev && prev.pageNumber === p.pageNumber
                      ? { ...prev, label: message }
                      : prev,
                  );
                },
                onTileStart: (event) => {
                  const tile = mapCropTileToPage(
                    crop,
                    event.tile,
                    p.widthPx,
                    p.heightPx,
                    cropWidthPx,
                    cropHeightPx,
                  );
                  const tileLabel =
                    event.total > 1
                      ? `OCR tile ${event.index}/${event.total}`
                      : `OCR ${regionLabel}`;
                  setOcrOverlay({
                    pageNumber: p.pageNumber,
                    region,
                    tile,
                    label: tileLabel,
                  });
                  setOcrStatus(
                    kind === "both"
                      ? `Page ${p.pageNumber} (${step}/${totalSteps}): ${regionLabel} — ${tileLabel}`
                      : `Page ${p.pageNumber} (${step}/${totalSteps}): ${tileLabel}…`,
                  );
                },
              },
            );
            const remapped = remapOcrLinesToLayoutRegion(
              out.sheet,
              crop,
              p.widthPx,
              p.heightPx,
              out.widthPx,
              out.heightPx,
            );
            ocrByPage.set(p.pageNumber, normalizePageOcrMeta(remapped));

            setOcrProgress({
              current: step,
              total: totalSteps,
              pageNumber: p.pageNumber,
              phase: "save",
            });
            setOcrStatus(
              `Page ${p.pageNumber} (${step}/${totalSteps}): saving ${regionLabel}…`,
            );
          }

          if (ac.signal.aborted) {
            if (runKind === "title_block" || runKind === "page" || kind === "both") {
              setTitleBlockOcrNotice("OCR cancelled.");
            }
            if (runKind === "drawing" || kind === "both") setDrawingOcrNotice("OCR cancelled.");
            return;
          }
          if (ocrByPage.size === 0) {
            throw new Error(`${regionLabel} OCR returned no text. Check the detected region.`);
          }

          latestPages = latestPages.map((p) => {
            const meta = ocrByPage.get(p.pageNumber);
            if (!meta) return p;
            if (runKind === "title_block" || runKind === "page") {
              return applyOcrLevelToPage(
                {
                  ...p,
                  scaleSource: meta.scaleText ? "title_block_text" : p.scaleSource,
                  scaleConfidence: meta.confidence ?? p.scaleConfidence,
                },
                meta,
              );
            }
            return { ...p, drawingOcrMeta: meta };
          });

          await projectStore.setResult(analysisId, {
            ...liveResult,
            pages: latestPages,
            modelVersions: {
              ...liveResult.modelVersions,
              ocr: latestPages.find((p) => p.ocrMeta?.provider)?.ocrMeta?.provider ?? "paddleocr",
            },
          });

          const lineCount = [...ocrByPage.values()].reduce(
            (sum, meta) => sum + (meta.ocrLineCount ?? meta.lines?.length ?? 0),
            0,
          );
          const notice = `${regionLabel} OCR: ${ocrByPage.size} page${ocrByPage.size === 1 ? "" : "s"}, ${lineCount} line${lineCount === 1 ? "" : "s"}.`;
          const cropDetail =
            runKind === "title_block" && pagesWithCrop.length === 1 && pagesWithCrop[0]
              ? (() => {
                  const info = findTitleBlockRegion(
                    analysisId,
                    pagesWithCrop[0].pageNumber,
                    pagesWithCrop[0].widthPx,
                    pagesWithCrop[0].heightPx,
                  );
                  return info ? ` Region: ${formatLayoutRegionSummary(info)}.` : "";
                })()
              : "";

          if (runKind === "title_block" || runKind === "page") {
            const targetForScale =
              latestPages.find((p) => p.pageNumber === pageNumber && ocrScaleTextForPage(p)) ??
              latestPages.find((p) => ocrScaleTextForPage(p));
            const parsedScale = targetForScale ? ocrScaleTextForPage(targetForScale) : null;
            if (targetForScale && parsedScale) {
              const liveScale = projectStore.getScaleInfo(analysisId) ?? scaleInfo;
              tryApplyOcrScaleForPage(targetForScale, liveScale);
              setTitleBlockOcrNotice(
                `${notice}${cropDetail} Scale detected: ${parsedScale} — scale calibrated and updated.`,
              );
            } else {
              setTitleBlockOcrNotice(`${notice}${cropDetail}`);
            }
          } else {
            const tiledPages = [...ocrByPage.values()].filter((m) => m.tiling?.tiled);
            const tileNote =
              tiledPages.length > 0
                ? ` Tiled ${tiledPages.map((m) => m.tiling?.tileCount ?? 0).join(" + ")} windows.`
                : "";
            setDrawingOcrNotice(`${notice}${tileNote}`);
          }
        }
      } catch (e) {
        if (isAbortError(e) || ac.signal.aborted) {
          if (kind === "title_block" || kind === "page" || kind === "both") {
            setTitleBlockOcrNotice("OCR cancelled.");
          }
          if (kind === "drawing" || kind === "both") setDrawingOcrNotice("OCR cancelled.");
          return;
        }
        const message = e instanceof Error ? e.message : "OCR failed";
        const friendly = message.includes("Failed to fetch")
          ? "Inference API is not running on :8000 (or OCR is not enabled)."
          : message;
        if (kind === "title_block" || kind === "page" || kind === "both") {
          setTitleBlockOcrError(friendly);
        }
        if (kind === "drawing" || kind === "both") setDrawingOcrError(friendly);
      } finally {
        if (ocrAbortRef.current === ac) ocrAbortRef.current = null;
        setOcrStatus(null);
        setOcrProgress(null);
        setOcrOverlay(null);
        setOcrBusy(false);
        setOcrKind(null);
      }
    },
    [
      analysisId,
      handleApplyOcrScale,
      page,
      pageNumber,
      result,
      scaleInfo,
      tryApplyOcrScaleForPage,
    ],
  );

  const runPageOcr = useCallback(
    (profile: "default" | "dense" = "default") =>
      runLayoutRegionOcr("page", { targetPages: [pageNumber] }),
    [pageNumber, runLayoutRegionOcr],
  );

  const runTitleBlockOcr = useCallback(
    (targetPages?: number[], applyScale = false) =>
      runLayoutRegionOcr("title_block", { targetPages, applyScale }),
    [runLayoutRegionOcr],
  );

  const runDrawingAreaOcr = useCallback(
    (targetPages?: number[]) => runLayoutRegionOcr("drawing", { targetPages }),
    [runLayoutRegionOcr],
  );

  const runAllPagesOcr = useCallback(
    () => runLayoutRegionOcr("both"),
    [runLayoutRegionOcr],
  );

  useEffect(() => {
    if (!page || !scaleInfo) return;

    const attemptKey = `${analysisId}:${page.pageNumber}`;
    const effectiveScale =
      layoutOcrScaleText ||
      (page.ocrMeta?.lines?.length ? canonicalScaleText(null, null, page.ocrMeta.lines) : null);

    if (effectiveScale && shouldApplyOcrScale(scaleInfo)) {
      const applyKey = `${attemptKey}:${effectiveScale}`;
      if (appliedOcrScaleKeyRef.current === applyKey) return;
      appliedOcrScaleKeyRef.current = applyKey;
      const applied = applyScaleFromOcrText(effectiveScale, scaleInfo, page, (opts) =>
        handleApplyOcrScale(opts, page),
      );
      if (!applied && appliedOcrScaleKeyRef.current === applyKey) {
        appliedOcrScaleKeyRef.current = null;
      }
      return;
    }

    if (inspectorTab !== "scale") return;
    if (!autoScaleOcr || ocrBusy) return;
    if (effectiveScale) return;
    if (autoScaleOcrAttemptedRef.current.has(attemptKey)) return;
    if (!titleBlockRegion) return;

    autoScaleOcrAttemptedRef.current.add(attemptKey);
    void runLayoutRegionOcr("title_block", {
      targetPages: [page.pageNumber],
      applyScale: true,
    });
  }, [
    analysisId,
    autoScaleOcr,
    handleApplyOcrScale,
    inspectorTab,
    layoutOcrScaleText,
    ocrBusy,
    page?.ocrMeta?.lines,
    page?.ocrMeta?.scaleText,
    page?.pageNumber,
    page?.widthPx,
    page?.heightPx,
    runLayoutRegionOcr,
    scaleInfo,
    titleBlockRegion,
  ]);

  const handleRotatePage = useCallback(
    async (deg: Exclude<PageRotationDeg, 0>) => {
      if (!page || !analysis || !result) return;
      setRotating(true);
      setRotateError(null);
      setRotateStatus(`Rotating page ${page.pageNumber}…`);
      try {
        const url = await resolvePageImagePath(page.imagePath, analysisId, page.pageNumber);
        const res = await fetch(url);
        if (!res.ok) throw new Error("Could not load the page image to rotate.");
        const srcBlob = await res.blob();
        const rotated = await rotateImageBlob(srcBlob, deg);
        await putPageImageBlob(analysisId, page.pageNumber, rotated.blob);
        if (analysis.storagePath) {
          await uploadPlanObject(
            `${analysis.storagePath}/page-${page.pageNumber}.png`,
            rotated.blob,
            "image/png",
          );
        }
        const key = pageKey(analysisId, page.pageNumber);
        const entities = useOverlayStore.getState().pages[key]?.entities ?? [];
        const nextEntities = entities.map((entity) =>
          rotateOverlayEntity(entity, page.widthPx, page.heightPx, deg),
        );
        useOverlayStore.getState().loadPageEntities(nextEntities, {
          analysisId,
          pageNumber: page.pageNumber,
        });
        await projectStore.setOverlays(analysisId, page.pageNumber, nextEntities);
        await projectStore.setResult(analysisId, {
          ...result,
          pages: result.pages.map((p) =>
            p.pageNumber === page.pageNumber
              ? {
                  ...p,
                  widthPx: rotated.widthPx,
                  heightPx: rotated.heightPx,
                  ocrMeta: null,
                  drawingOcrMeta: null,
                }
              : p,
          ),
        });
        if (
          scaleInfo &&
          (deg === 90 || deg === 270) &&
          page.pageNumber === (result.pages[0]?.pageNumber ?? 1)
        ) {
          await projectStore.setScaleInfo(analysisId, {
            ...scaleInfo,
            pageWidthPt: scaleInfo.pageHeightPt,
            pageHeightPt: scaleInfo.pageWidthPt,
            pageWidthMm: scaleInfo.pageHeightMm,
            pageHeightMm: scaleInfo.pageWidthMm,
          });
        }
        const freshUrl = await resolvePageImagePath(page.imagePath, analysisId, page.pageNumber);
        setPageImageUrl((prev) => {
          if (prev?.startsWith("blob:") && prev !== freshUrl) URL.revokeObjectURL(prev);
          return freshUrl;
        });
        resetView();
      } catch (e) {
        setRotateError(e instanceof Error ? e.message : "Could not rotate the page.");
      } finally {
        setRotating(false);
        setRotateStatus(null);
      }
    },
    [analysis, analysisId, page, resetView, result, scaleInfo],
  );

  const handleRotateAllPages = useCallback(
    async (deg: Exclude<PageRotationDeg, 0>) => {
      if (!analysis || !result?.pages.length) return;
      setRotating(true);
      setRotateError(null);
      const total = result.pages.length;
      try {
        let nextPages = [...result.pages];
        for (let i = 0; i < total; i++) {
          const p = nextPages[i]!;
          setRotateStatus(`Rotating page ${p.pageNumber} (${i + 1}/${total})…`);
          const url = await resolvePageImagePath(p.imagePath, analysisId, p.pageNumber);
          const res = await fetch(url);
          if (!res.ok) {
            throw new Error(`Could not load page ${p.pageNumber} image to rotate.`);
          }
          const srcBlob = await res.blob();
          const rotated = await rotateImageBlob(srcBlob, deg);
          await putPageImageBlob(analysisId, p.pageNumber, rotated.blob);
          if (analysis.storagePath) {
            await uploadPlanObject(
              `${analysis.storagePath}/page-${p.pageNumber}.png`,
              rotated.blob,
              "image/png",
            );
          }
          const key = pageKey(analysisId, p.pageNumber);
          const entities = useOverlayStore.getState().pages[key]?.entities ?? [];
          const nextEntities = entities.map((entity) =>
            rotateOverlayEntity(entity, p.widthPx, p.heightPx, deg),
          );
          useOverlayStore.getState().loadPageEntities(nextEntities, {
            analysisId,
            pageNumber: p.pageNumber,
          });
          await projectStore.setOverlays(analysisId, p.pageNumber, nextEntities);
          nextPages = nextPages.map((row) =>
            row.pageNumber === p.pageNumber
              ? {
                  ...row,
                  widthPx: rotated.widthPx,
                  heightPx: rotated.heightPx,
                  ocrMeta: null,
                  drawingOcrMeta: null,
                }
              : row,
          );
        }
        await projectStore.setResult(analysisId, { ...result, pages: nextPages });
        if (scaleInfo && (deg === 90 || deg === 270)) {
          await projectStore.setScaleInfo(analysisId, {
            ...scaleInfo,
            pageWidthPt: scaleInfo.pageHeightPt,
            pageHeightPt: scaleInfo.pageWidthPt,
            pageWidthMm: scaleInfo.pageHeightMm,
            pageHeightMm: scaleInfo.pageWidthMm,
          });
        }
        if (page) {
          const freshUrl = await resolvePageImagePath(
            page.imagePath,
            analysisId,
            page.pageNumber,
          );
          setPageImageUrl((prev) => {
            if (prev?.startsWith("blob:") && prev !== freshUrl) URL.revokeObjectURL(prev);
            return freshUrl;
          });
        }
        resetView();
      } catch (e) {
        setRotateError(e instanceof Error ? e.message : "Could not rotate pages.");
      } finally {
        setRotating(false);
        setRotateStatus(null);
      }
    },
    [analysis, analysisId, page, resetView, result, scaleInfo],
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

  const inspectorTabs = [
    { id: "layout", label: "Layout", title: "Sheet layout and regions" },
    {
      id: "ocr",
      label: "OCR",
      title: "PaddleOCR text extraction & options",
      badge:
        ((page?.ocrMeta?.ocrLineCount ?? page?.ocrMeta?.lines?.length ?? 0) +
          (page?.drawingOcrMeta?.ocrLineCount ?? page?.drawingOcrMeta?.lines?.length ?? 0)) > 0
          ? (page?.ocrMeta?.ocrLineCount ?? page?.ocrMeta?.lines?.length ?? 0) +
            (page?.drawingOcrMeta?.ocrLineCount ?? page?.drawingOcrMeta?.lines?.length ?? 0)
          : null,
    },
    { id: "scale", label: "Scale", title: "Scale calibration" },
    {
      id: "detect",
      label: "Detect",
      title: "Region detection",
      badge: detection.regionCount > 0 ? detection.regionCount : null,
    },
    {
      id: "hierarchy",
      label: "Tree",
      title: "Building hierarchy",
      badge: liveHierarchy?.units.length ? liveHierarchy.units.length : null,
    },
  ];

  const handleInspectorTabChange = (id: string) => {
    const tab = id as InspectorTabId;
    setInspectorTab(tab);
    if (tab === "detect" || tab === "hierarchy" || tab === "layout" || tab === "ocr") {
      setToolMode("none");
      setMeasurePoints([]);
      if (tab === "layout") {
        setOverlayTool("select");
        setLayoutDrawType(null);
      } else {
        setOverlayTool("pan");
        setLayoutDrawType(null);
      }
    }
  };

  const inspectorTitle =
    inspectorTab === "layout"
      ? "Layout"
      : inspectorTab === "ocr"
        ? "PaddleOCR"
        : inspectorTab === "scale"
          ? "Scale"
          : inspectorTab === "detect"
            ? "Detect"
            : "Hierarchy";

  return (
    <WorkspaceShell
      statusText={[analysis.sourceFileName, pageStatus, graphicsLabel, scaleLabel]
        .filter(Boolean)
        .join(" · ")}
      leftPanelTitle="Pages"
      leftPanel={
        <>
          <PageThumbnailStrip
            analysisId={analysisId}
            pages={result?.pages ?? []}
            activeIndex={pageIndex}
            onSelect={setPageIndex}
            onDeletePage={(p) => void handleDeletePage(p)}
            deletingPageNumber={deletingPageNumber}
            size="small"
          />
          {pageDeleteError ? (
            <p className="px-2 pb-2 text-[11px] leading-relaxed text-red-600">{pageDeleteError}</p>
          ) : null}
        </>
      }
      inspectorTitle={inspectorTitle}
      inspector={
        <div className="flex min-h-0 flex-1 flex-col">
        <VerticalInspectorTabs
          tabs={inspectorTabs}
          activeId={inspectorTab}
          onChange={handleInspectorTabChange}
          footer={
            <button
              type="button"
              className="w-full rounded border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
              onClick={handleDeleteDrawing}
            >
              Delete drawing
            </button>
          }
        >
          {inspectorTab === "layout" ? (
            <>
              {page ? (
                <PageInfoCard
                  page={page}
                  pageCount={pageCount}
                  levelName={resolvedPageLevel?.levelName}
                />
              ) : null}
              <ManualLayoutPanel
                  analysisId={analysisId}
                  pageNumber={page?.pageNumber ?? 1}
                  pageWidthPx={page?.widthPx ?? 0}
                  pageHeightPx={page?.heightPx ?? 0}
                  disabled={ocrBusy || detection.detecting}
                />
              {page ? (
                <LayoutRegionInspector
                  analysisId={analysisId}
                  pageNumber={page.pageNumber}
                  pageWidthPx={page.widthPx}
                  pageHeightPx={page.heightPx}
                />
              ) : null}
                <div className="space-y-2 rounded border border-slate-200 px-3 py-2">
                  <p className="text-[11px] font-medium text-slate-700">Sheet layout (YOLO)</p>
                  <p className="text-[11px] leading-relaxed text-slate-500">
                    Optional automatic detection of drawing area, legend block, and title block
                    using{" "}
                    <a
                      href="https://huggingface.co/GreenMap/yolo11x-blueprint-layout-detector"
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-600 hover:underline"
                    >
                      GreenMap layout detector
                    </a>
                    . Use manual layout above if this fails.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                      disabled={detection.detecting || ocrBusy || !pageImageUrl}
                      onClick={() => void detection.runLayoutDetect()}
                    >
                      {detection.detecting && !detection.progress?.batchTotal
                        ? detection.progress?.label ?? "Detecting layout…"
                        : "Detect layout (this page)"}
                    </button>
                    <button
                      type="button"
                      className="flex-1 rounded border border-brand-300 bg-white px-3 py-1.5 text-xs font-medium text-brand-900 hover:bg-brand-50 disabled:opacity-50"
                      disabled={detection.detecting || ocrBusy || pageCount < 1}
                      onClick={() => void detection.runLayoutDetectAllPages()}
                    >
                      {detection.detecting && detection.progress?.batchTotal
                        ? detection.progress?.label ?? "Detecting layout…"
                        : `Detect layout (all ${pageCount} pages)`}
                    </button>
                    {detection.detecting ? (
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        onClick={() => detection.cancelDetect()}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                  {detection.detecting &&
                  detection.progress &&
                  (detection.progress.batchTotal ?? detection.progress.total) > 0 ? (
                    <div className="space-y-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-brand-600 transition-all"
                          style={{
                            width: `${
                              (100 * detection.progress.index) /
                              Math.max(
                                1,
                                detection.progress.batchTotal ?? detection.progress.total,
                              )
                            }%`,
                          }}
                        />
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-600">
                        {detection.progress.label}
                      </p>
                    </div>
                  ) : null}
                  {detection.detectError && inspectorTab === "layout" ? (
                    <p className="text-[11px] leading-relaxed text-red-600">{detection.detectError}</p>
                  ) : detection.detectWarning && inspectorTab === "layout" ? (
                    <p className="text-[11px] leading-relaxed text-amber-700">{detection.detectWarning}</p>
                  ) : null}
                </div>
                <div className="space-y-2 rounded border border-brand-200 bg-brand-50/40 px-3 py-2">
                  <p className="text-[11px] font-medium text-slate-700">OCR all pages</p>
                  <p className="text-[11px] leading-relaxed text-slate-500">
                    Run <strong>title block</strong> and <strong>drawing area</strong> OCR on
                    every page that has layout regions ({pageCount} page{pageCount === 1 ? "" : "s"}).
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="flex-1 rounded border border-brand-300 bg-white px-3 py-1.5 text-xs font-medium text-brand-900 hover:bg-brand-50 disabled:opacity-50"
                      disabled={ocrBusy || !pageImageUrl || pageCount < 1}
                      onClick={() => void runAllPagesOcr()}
                    >
                      {ocrBusy && ocrKind === "both"
                        ? ocrStatus ?? "OCR all pages…"
                        : "OCR title block + drawing (all pages)"}
                    </button>
                    {ocrBusy && ocrKind === "both" ? (
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        onClick={cancelOcr}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                  {ocrBusy && ocrKind === "both" && ocrProgress && ocrProgress.total > 0 ? (
                    <div className="space-y-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-brand-600 transition-all"
                          style={{ width: `${ocrProgressPercent(ocrProgress)}%` }}
                        />
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-600">{ocrStatus}</p>
                    </div>
                  ) : null}
                </div>
                <div className="space-y-2 rounded border border-slate-200 px-3 py-2">
                  <p className="text-[11px] font-medium text-slate-700">Title block OCR</p>
                  <p className="text-[11px] leading-relaxed text-slate-500">
                    Reads sheet metadata from the detected <strong>title_block</strong> layout
                    region only — scale (<code className="text-[10px]">1:100 @ A1</code>), level,
                    sheet title, unit ids. Crops the same {PDF_RENDER_DPI} DPI page image used by
                    the viewer and layout detector.
                  </p>
                  {titleBlockRegion ? (
                    <p className="rounded border border-teal-100 bg-teal-50/60 px-2 py-1.5 text-[11px] text-teal-900">
                      Selected: {formatLayoutRegionSummary(titleBlockRegion)}
                    </p>
                  ) : (
                    <p className="text-[11px] leading-relaxed text-amber-700">
                      No title block region yet — draw one manually or run layout detection.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                      disabled={ocrBusy || !pageImageUrl}
                      onClick={() => void runTitleBlockOcr()}
                    >
                      {ocrBusy && ocrKind === "title_block"
                        ? ocrStatus ?? "OCR title block…"
                        : "OCR title block"}
                    </button>
                    {layoutOcrScaleText && scaleInfo ? (
                      <button
                        type="button"
                        className="rounded border border-brand-300 px-3 py-1.5 text-xs font-medium text-brand-800 hover:bg-brand-50 disabled:opacity-50"
                        disabled={ocrBusy}
                        onClick={() =>
                          applyScaleFromOcrText(
                            layoutOcrScaleText,
                            scaleInfo,
                            page,
                            handleApplyOcrScale,
                          )
                        }
                      >
                        Apply scale
                      </button>
                    ) : null}
                    {ocrBusy && ocrKind === "title_block" ? (
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        onClick={cancelOcr}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                  {ocrBusy && ocrKind === "title_block" && ocrProgress && ocrProgress.total > 0 ? (
                    <div className="space-y-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-brand-600 transition-all"
                          style={{ width: `${ocrProgressPercent(ocrProgress)}%` }}
                        />
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-600">{ocrStatus}</p>
                    </div>
                  ) : null}
                  {titleBlockOcrNotice ? (
                    <p className="text-[11px] leading-relaxed text-emerald-700">{titleBlockOcrNotice}</p>
                  ) : null}
                  {titleBlockOcrError ? (
                    <p className="text-[11px] leading-relaxed text-red-600">{titleBlockOcrError}</p>
                  ) : pageOcr ? (
                    <div className="space-y-2 text-[11px] leading-relaxed text-slate-600">
                      {resolvedPageLevel?.levelName || pageOcr?.levelName ? (
                        <p>Level: {resolvedPageLevel?.levelName ?? pageOcr?.levelName}</p>
                      ) : null}
                      {pageOcr.scaleText ? <p>Scale: {pageOcr.scaleText}</p> : null}
                      {pageOcr.title ? <p className="truncate">Title: {pageOcr.title}</p> : null}
                      {pageOcr.unitIds && pageOcr.unitIds.length > 0 ? (
                        <p>Units: {pageOcr.unitIds.join(", ")}</p>
                      ) : null}
                      {pageOcr.textHint ? (
                        <p className="whitespace-pre-wrap text-slate-500">{pageOcr.textHint}</p>
                      ) : null}
                      <OcrLinesPreview
                        meta={pageOcr}
                        emptyLabel="No OCR lines returned for the title block."
                      />
                      <p className="text-slate-400">
                        {pageOcr.ocrLineCount ?? pageOcr.lines?.length ?? 0} lines ·{" "}
                        {pageOcr.provider}
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] leading-relaxed text-slate-500">
                      Requires layout detection. Enable with{" "}
                      <code className="text-[10px]">PADDLE_OCR_ENABLED=true</code>.
                    </p>
                  )}
                </div>
                <div className="space-y-2 rounded border border-slate-200 px-3 py-2">
                  <p className="text-[11px] font-medium text-slate-700">Drawing area OCR</p>
                  <p className="text-[11px] leading-relaxed text-slate-500">
                    Reads text inside the detected <strong>main_floorplan</strong> layout region —
                    room labels, dimensions, and notes. Crops larger than PaddleOCR&apos;s 960px
                    default are OCR&apos;d in overlapping tiles (same pattern as YOLO inference).
                  </p>
                  {drawingAreaRegion ? (
                    <p className="rounded border border-sky-100 bg-sky-50/60 px-2 py-1.5 text-[11px] text-sky-900">
                      Selected: {formatLayoutRegionSummary(drawingAreaRegion)}
                    </p>
                  ) : (
                    <p className="text-[11px] leading-relaxed text-amber-700">
                      No drawing area region yet — draw one manually or run layout detection.
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                      disabled={ocrBusy || !pageImageUrl}
                      onClick={() => void runDrawingAreaOcr()}
                    >
                      {ocrBusy && ocrKind === "drawing"
                        ? ocrStatus ?? "OCR drawing area…"
                        : "OCR drawing area"}
                    </button>
                    {ocrBusy && ocrKind === "drawing" ? (
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        onClick={cancelOcr}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                  {ocrBusy && ocrKind === "drawing" && ocrProgress && ocrProgress.total > 0 ? (
                    <div className="space-y-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-sky-600 transition-all"
                          style={{ width: `${ocrProgressPercent(ocrProgress)}%` }}
                        />
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-600">{ocrStatus}</p>
                    </div>
                  ) : null}
                  {drawingOcrNotice ? (
                    <p className="text-[11px] leading-relaxed text-emerald-700">{drawingOcrNotice}</p>
                  ) : null}
                  {drawingOcrError ? (
                    <p className="text-[11px] leading-relaxed text-red-600">{drawingOcrError}</p>
                  ) : pageDrawingOcr ? (
                    <div className="space-y-2 text-[11px] leading-relaxed text-slate-600">
                      <OcrLinesPreview
                        meta={pageDrawingOcr}
                        emptyLabel="No OCR lines returned for the drawing area."
                      />
                      <p className="text-slate-400">
                        {pageDrawingOcr.ocrLineCount ?? pageDrawingOcr.lines?.length ?? 0} lines ·{" "}
                        {pageDrawingOcr.provider}
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] leading-relaxed text-slate-500">
                      Requires layout detection to find the drawing area first.
                    </p>
                  )}
                </div>
              </>
            ) : inspectorTab === "ocr" ? (
              <OcrPanel
                pageNumber={page?.pageNumber ?? 1}
                pageCount={pageCount}
                ocrMeta={page?.ocrMeta}
                drawingOcrMeta={page?.drawingOcrMeta}
                ocrLines={page?.ocrMeta?.lines}
                ocrBusy={ocrBusy}
                ocrStatus={ocrStatus}
                ocrProgress={ocrProgress}
                ocrNotice={titleBlockOcrNotice || drawingOcrNotice}
                ocrError={titleBlockOcrError || drawingOcrError}
                onRunPageOcr={(profile) => void runPageOcr(profile)}
                onRunTitleBlockOcr={() => void runTitleBlockOcr([pageNumber], true)}
                onRunDrawingAreaOcr={() => void runDrawingAreaOcr([pageNumber])}
                onRunAllPagesOcr={() => void runAllPagesOcr()}
                onCancelOcr={cancelOcr}
                onApplyDetectedScale={
                  page?.ocrMeta?.scaleText && scaleInfo
                    ? () => {
                        if (page?.ocrMeta?.scaleText) {
                          applyScaleFromOcrText(page.ocrMeta.scaleText, scaleInfo, page, (opts) =>
                            handleApplyOcrScale(opts, page),
                          );
                        }
                      }
                    : undefined
                }
              />
            ) : inspectorTab === "scale" ? (
              <>
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
                    ocrScaleText={effectiveOcrScaleText}
                    ocrLines={page?.ocrMeta?.lines}
                    scaleOcrBusy={ocrBusy && (ocrKind === "title_block" || ocrKind === "both")}
                    scaleOcrStatus={
                      ocrKind === "title_block" || ocrKind === "both" ? ocrStatus : null
                    }
                    scaleOcrProgress={
                      ocrKind === "title_block" || ocrKind === "both" ? ocrProgress : null
                    }
                    scaleOcrNotice={titleBlockOcrNotice}
                    scaleOcrError={titleBlockOcrError}
                    titleBlockRegionSet={Boolean(titleBlockRegion)}
                    autoScaleOcr={autoScaleOcr}
                    onAutoScaleOcrChange={(checked) => {
                      setAutoScaleOcr(checked);
                      if (checked) {
                        autoScaleOcrAttemptedRef.current.delete(
                          `${analysisId}:${pageNumber}`,
                        );
                      }
                    }}
                    onApplyOcrScale={
                      effectiveOcrScaleText && page
                        ? () =>
                            applyScaleFromOcrText(
                              effectiveOcrScaleText,
                              scaleInfo,
                              page,
                              handleApplyOcrScale,
                            )
                        : undefined
                    }
                    onRunTitleBlockOcr={() => void runTitleBlockOcr([pageNumber], true)}
                    onCancelScaleOcr={cancelOcr}
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
            ) : inspectorTab === "hierarchy" ? (
              <HierarchyPanel
                hierarchy={liveHierarchy}
                activePageNumber={pageNumber}
                selectedId={selectedIds[0] ?? null}
                onSelectFloorPage={(n) => {
                  const idx = result?.pages.findIndex((p) => p.pageNumber === n) ?? -1;
                  if (idx >= 0) setPageIndex(idx);
                }}
                onSelect={(id) => {
                  // Switch to the floor that owns this entity when needed.
                  const floor = liveHierarchy?.floors.find(
                    (f) =>
                      f.unitIds.includes(id) ||
                      f.commonAreaIds.includes(id) ||
                      f.unassignedRoomIds.includes(id) ||
                      f.unitIds.some((uid) =>
                        liveHierarchy.units.find((u) => u.id === uid)?.roomIds.includes(id),
                      ),
                  );
                  if (floor && floor.pageNumber !== pageNumber) {
                    const idx = result?.pages.findIndex((p) => p.pageNumber === floor.pageNumber) ?? -1;
                    if (idx >= 0) setPageIndex(idx);
                  }
                  selectOverlay([id]);
                }}
              />
            ) : inspectorTab === "detect" ? (
              <>
                <div className="space-y-2">
                  <DetectModelSelect
                    value={detection.detectModelId}
                    onChange={detection.selectDetectModel}
                    disabled={detection.detecting}
                    graphicsKind={page?.graphicsKind}
                  />
                  <label className="flex items-start gap-2 text-[11px] leading-snug text-slate-600">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={detection.autoDetect}
                      disabled={detection.detecting}
                      onChange={(e) => detection.setAutoDetect(e.target.checked)}
                    />
                    <span>Auto-detect when opening a page (off by default)</span>
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="flex-1 rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                      disabled={detection.detecting}
                      onClick={() => void detection.runDetect()}
                    >
                      {detection.detecting
                        ? detection.progress?.label ?? "Detecting…"
                        : "Detect regions"}
                    </button>
                    {detection.detecting ? (
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        onClick={() => detection.cancelDetect()}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                  {detection.detecting && detection.progress && detection.progress.total > 0 ? (
                    <div className="h-1.5 overflow-hidden rounded bg-slate-100">
                      <div
                        className="h-full bg-sky-600 transition-all"
                        style={{
                          width: `${Math.min(
                            100,
                            (100 * detection.progress.index) / Math.max(1, detection.progress.total),
                          )}%`,
                        }}
                      />
                    </div>
                  ) : null}
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
                        ? detection.progress?.label ?? "Running detection…"
                        : detection.regionCount > 0
                          ? `${detection.regionCount} regions · ${detection.modelLabel ?? "detector"} · select to keep or reject`
                          : (detection.detectWarning ??
                            "Pick a model, then Detect regions. Large pages run tile-by-tile.")}
                  </p>
                  <Link href="/studio" className="block text-[11px] text-brand-700 hover:underline">
                    Annotate and fine-tune in Model Studio
                  </Link>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                      disabled={policyBusy || detection.detecting}
                      onClick={() => void runPolicyCheck()}
                    >
                      {policyBusy ? "Running policy…" : "Run policy check"}
                    </button>
                    {policyBusy ? (
                      <button
                        type="button"
                        className="rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        onClick={cancelPolicyCheck}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                  {policyError ? (
                    <p className="text-[11px] leading-relaxed text-red-600">{policyError}</p>
                  ) : result?.complianceResults?.length ? (
                    <p className="text-[11px] leading-relaxed text-slate-500">
                      {result.complianceResults.length} policy result
                      {result.complianceResults.length === 1 ? "" : "s"} ·{" "}
                      <Link
                        href={`/projects/${projectId}/analyses/${analysisId}/review`}
                        className="text-brand-700 hover:underline"
                      >
                        Open review
                      </Link>
                    </p>
                  ) : (
                    <p className="text-[11px] leading-relaxed text-slate-500">
                      After detect + scale, run policy check to evaluate design rules.
                    </p>
                  )}
                </div>
                <OverlayLayerPanel sourceFilter="model" />
                <EntityInspector sourceFilter="model" />
              </>
            ) : null}
        </VerticalInspectorTabs>
        </div>
      }
    >
      <div className="flex h-full min-h-0 flex-col bg-white">
        <OverlayHotkeys enabled={toolMode === "none"} layoutEditMode={inspectorTab === "layout"} />
        <EditorToolbar
          pageCount={pageCount}
          onRotateCw={() => void handleRotatePage(90)}
          onRotateCcw={() => void handleRotatePage(270)}
          onRotateAllCw={() => void handleRotateAllPages(90)}
          onRotateAllCcw={() => void handleRotateAllPages(270)}
          rotating={rotating}
          rotateStatus={rotateStatus}
        />
        {rotateError ? (
          <p className="border-b border-red-100 bg-red-50 px-3 py-1 text-[11px] text-red-700">
            {rotateError}
          </p>
        ) : null}

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
            overlayMode="detections"
            measurePoints={measurePoints}
            measureLabel={measureLabel}
            onMeasurePoint={handleMeasurePoint}
            activeDetectTile={detection.progress?.tile ?? null}
            ocrRegion={ocrOverlay?.pageNumber === pageNumber ? ocrOverlay.region : null}
            activeOcrTile={ocrOverlay?.pageNumber === pageNumber ? ocrOverlay.tile : null}
            ocrHighlights={ocrHighlights}
            showOcrToggle={true}
            layoutEditMode={inspectorTab === "layout" && toolMode === "none"}
            detectProgressLabel={
              detection.detecting ? detection.progress?.label ?? "Detecting…" : null
            }
            ocrProgressLabel={
              ocrBusy && ocrOverlay?.pageNumber === pageNumber ? ocrOverlay.label : null
            }
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
