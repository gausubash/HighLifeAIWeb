"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProjectSidebar } from "@/components/shell/ProjectSidebar";
import { AnalysisRightSidebar } from "@/features/analyses/AnalysisRightSidebar";
import { VerticalInspectorTabs } from "@/components/shell/VerticalInspectorTabs";
import { WorkspaceShell } from "@/components/shell/WorkspaceShell";
import { PdfPageViewer } from "@/features/plan-viewer/PdfPageViewer";
import { useViewerStore } from "@/features/plan-viewer/useViewerStore";
import { EditorToolbar } from "@/features/plan-editor/EditorToolbar";
import { DetectPanel } from "@/features/plan-editor/DetectPanel";
import { OverlayViewSection } from "@/features/plan-editor/OverlayViewSection";
import { ManualLayoutPanel } from "@/features/plan-editor/ManualLayoutPanel";
import { OverlayHotkeys } from "@/features/plan-editor/OverlayHotkeys";
import { HierarchyPanel } from "@/features/analyses/HierarchyPanel";
import { ReviewPanel } from "@/features/analyses/ReviewPanel";
import { GeometryPanel } from "@/features/analyses/GeometryPanel";
import { GraphPanel } from "@/features/analyses/GraphPanel";
import { useGeometryExtractStore } from "@/features/analyses/useGeometryExtractStore";
import { useUnitGraphView } from "@/features/analyses/useUnitGraphView";
import { PolicyPanel } from "@/features/policy/PolicyPanel";
import { OcrPanel } from "@/features/ocr/OcrPanel";
import { useAppendDrawingPages } from "@/features/uploads/useAppendDrawingPages";
import { ocrRunFromChecks } from "@/features/ocr/ocrRunScope";
import { applyOcrResolution } from "@/features/ocr/ocrResolution";
import { useOcrSettingsStore } from "@/features/ocr/useOcrSettingsStore";
import { pageKey, useOverlayStore } from "@/features/plan-editor/useOverlayStore";
import { usePageRegionDetect } from "@/features/plan-editor/usePageRegionDetect";
import { ScalePanel, type ScaleToolMode } from "@/features/scale/ScalePanel";
import { useAnalysisBundle, useProject } from "@/hooks/useProjectStore";
import { computeApartmentSheet } from "@/lib/hierarchy/apartmentCharacteristics";
import { ocrLinesFromPage } from "@/lib/hierarchy/apartmentType";
import { evaluatePolicyPack } from "@/lib/policy/evaluatePolicy";
import { resolveActivePack } from "@/lib/policy/usePolicyStore";
import {
  ocrPageImageStream,
  OcrStreamCancelled,
  scaleSheetOcrMeta,
  type SheetOcrMeta,
} from "@/lib/api/ocrClient";
import { projectStore } from "@/lib/data/projectStore";
import { buildHierarchyFromOverlays } from "@/lib/hierarchy/buildHierarchy";
import { applyUnitBoundariesFromPage } from "@/lib/hierarchy/applyUnitBoundaries";
import {
  addManualUnitIds,
  applyOcrLevelToPage,
  parseManualUnitIds,
  pickLevelFromOcrMeta,
  pickUnitIdsFromOcrMeta,
  removeManualUnitId,
  resolveBuildingName,
  resolveFloorPageMeta,
} from "@/lib/hierarchy/pageLevel";
import {
  clearOcrLines,
  removeOcrLineAt,
  type OcrLineSource,
} from "@/lib/ocr/removeOcrLine";
import { pdfGraphicsLabel } from "@/lib/pdf/classifyPdfGraphics";
import {
  extractPdfPageText,
  filterPdfTextToDrawingArea,
  splitPdfTextByLayoutCrops,
} from "@/lib/pdf/extractPdfText";
import { putPageImageBlob, resolvePageImagePath } from "@/lib/pdf/pageImageStore";
import { inferRenderDpi } from "@/lib/pdf/renderPdfFirstPage";
import {
  normalizeRotation,
  rotateOverlayEntity,
  scaleOverlayEntity,
  type PageRotationDeg,
} from "@/lib/pdf/pageRotation";
import { rotateImageBlob } from "@/lib/pdf/rotateRaster";
import { signedPlanUrl, uploadPlanObject } from "@/lib/supabase/plans";
import {
  A_PAPER_SIZES_MM,
  calibrateFromScaleAndPaper,
  calibrateFromTwoPoints,
  canonicalScaleText,
  pixelsPerMeterFromScaleAndPaper,
  formatMeasuredLength,
  lengthFromPixels,
  parseScaleAndPaper,
  pixelDistance,
  scaleMethodLabel,
  type PointPx,
  type ScaleInfo,
} from "@/lib/scale/parseScale";
import {
  applyScaleFromOcrText,
  cropImageBlob,
  ensureOcrLinesInPageSpace,
  findDrawingAreaCrop,
  findTitleBlockCrop,
  findTitleBlockRegion,
  formatLayoutRegionSummary,
  layoutCropToPageRect,
  mapCropTileToPage,
  ocrBboxPoints,
  ocrFrameFromPixelCrop,
  ocrScaleTextForPage,
  scaleOcrBboxes,
  shouldApplyOcrScale,
} from "@/lib/scale/layoutRegionCrop";
import {
  buildSpatialOcrRooms,
  unitBoundariesFromEntities,
} from "@/lib/geometry/ocrSpatialRooms";

type InspectorTabId =
  | "project"
  | "layout"
  | "ocr"
  | "detect"
  | "geometry"
  | "graph"
  | "hierarchy"
  | "policy"
  | "review";

const INSPECTOR_TABS = new Set<InspectorTabId>([
  "project",
  "layout",
  "ocr",
  "detect",
  "geometry",
  "graph",
  "hierarchy",
  "policy",
  "review",
]);

const EMPTY_SELECTED_IDS: string[] = [];

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(",", 2);
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? "image/png";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function isAbortError(e: unknown): boolean {
  return (
    (e instanceof Error && e.name === "AbortError") || e instanceof OcrStreamCancelled
  );
}

function ocrLinesToHighlights(
  meta: SheetOcrMeta | null | undefined,
  source: "title_block" | "drawing",
) {
  const lines = meta?.lines ?? [];
  return lines.flatMap((l) => {
    if (!l.text?.trim()) return [];
    const pts = ocrBboxPoints(l.bbox);
    if (!pts) return [];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs);
    const y0 = Math.min(...ys);
    const x1 = Math.max(...xs);
    const y1 = Math.max(...ys);
    return [
      {
        x: x0,
        y: y0,
        width: x1 - x0,
        height: y1 - y0,
        text: l.text.trim(),
        confidence: l.confidence ?? 0,
        source,
        points: pts.map(([x, y]) => ({ x, y })),
      },
    ];
  });
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
    ocrFrame: sheet.ocrFrame,
    coordSpace: sheet.coordSpace,
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
  const { analysis, result, scaleInfo, ready } = useAnalysisBundle(analysisId);
  const { project } = useProject(projectId);
  const [toolMode, setToolMode] = useState<ScaleToolMode>("none");
  const [measurePoints, setMeasurePoints] = useState<PointPx[]>([]);
  const [inspectorTab, setInspectorTab] = useState<InspectorTabId>("project");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const tab = new URLSearchParams(window.location.search).get("tab");
    if (tab && INSPECTOR_TABS.has(tab as InspectorTabId)) {
      setInspectorTab(tab as InspectorTabId);
    }
  }, []);
  const [pageImageUrl, setPageImageUrl] = useState<string | null>(null);
  const [pageImageError, setPageImageError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [rotateError, setRotateError] = useState<string | null>(null);
  const [rotateStatus, setRotateStatus] = useState<string | null>(null);
  const [dpiBusy, setDpiBusy] = useState(false);
  const [dpiStatus, setDpiStatus] = useState<string | null>(null);
  const [dpiError, setDpiError] = useState<string | null>(null);
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
  const [unitInferNotice, setUnitInferNotice] = useState<string | null>(null);
  const ocrAbortRef = useRef<AbortController | null>(null);
  const appliedOcrScaleKeyRef = useRef<string | null>(null);
  const policyAbortRef = useRef<AbortController | null>(null);
  const prevAnalysisIdRef = useRef<string | null>(null);
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
  const geometryPageKey = useGeometryExtractStore((s) => s.pageKey);
  const geometryRooms = useGeometryExtractStore((s) => s.rooms);
  const geometryGraph = useGeometryExtractStore((s) => s.graph);
  const geometryRoomCount = geometryRooms.length;
  const geometrySelectedId = useGeometryExtractStore((s) => s.selectedId);
  const showGraphOnPlan = useGeometryExtractStore((s) => s.showGraphOnPlan);
  const setGeometrySelectedId = useGeometryExtractStore((s) => s.setSelectedId);
  const pageCount = result?.pages.length ?? 0;
  const page = result?.pages[pageIndex];
  const pageNumber = page?.pageNumber ?? 1;
  const pageOcr = page?.ocrMeta;
  const layoutOcrScaleText = useMemo(() => ocrScaleTextForPage(page), [page]);
  const pageDrawingOcr = page?.drawingOcrMeta;
  const titleBlockRegion = useMemo(() => {
    if (!page) return null;
    return findTitleBlockRegion(analysisId, page.pageNumber, page.widthPx, page.heightPx);
  }, [analysisId, overlayPages, page]);

  const resolvedPageLevel = useMemo(
    () => (page && result ? resolveFloorPageMeta(page, result.sourceFileName) : null),
    [page, result],
  );
  const titleBlockHighlights = useMemo(() => {
    if (!page) return [];
    const crop = findTitleBlockCrop(analysisId, page.pageNumber, page.widthPx, page.heightPx);
    return ocrLinesToHighlights(
      ensureOcrLinesInPageSpace(pageOcr, crop, page.widthPx, page.heightPx),
      "title_block",
    );
  }, [analysisId, overlayPages, page, pageOcr]);
  const drawingHighlights = useMemo(() => {
    if (!page) return [];
    const crop = findDrawingAreaCrop(analysisId, page.pageNumber, page.widthPx, page.heightPx);
    return ocrLinesToHighlights(
      ensureOcrLinesInPageSpace(pageDrawingOcr, crop, page.widthPx, page.heightPx),
      "drawing",
    );
  }, [analysisId, overlayPages, page, pageDrawingOcr]);
  const pageSpaceDrawingOcrLines = useMemo(() => {
    if (!page) return null;
    const crop = findDrawingAreaCrop(analysisId, page.pageNumber, page.widthPx, page.heightPx);
    return ensureOcrLinesInPageSpace(pageDrawingOcr, crop, page.widthPx, page.heightPx)?.lines ?? null;
  }, [analysisId, page, pageDrawingOcr]);
  const ocrRoomMarkers = useMemo(() => {
    if (inspectorTab !== "graph" || !showGraphOnPlan) return [];
    if (!pageSpaceDrawingOcrLines?.length) return [];
    const entities = overlayPages[pageKey(analysisId, pageNumber)]?.entities ?? [];
    const units = unitBoundariesFromEntities(entities);
    if (!units.length) return [];
    return buildSpatialOcrRooms(pageSpaceDrawingOcrLines, units).map((r) => ({
      x: r.centroid.x,
      y: r.centroid.y,
      label: r.label,
      unitLabel: r.unitLabel,
    }));
  }, [inspectorTab, showGraphOnPlan, pageSpaceDrawingOcrLines, overlayPages, analysisId, pageNumber]);

  const unitGraphView = useUnitGraphView({
    analysisId,
    pageNumber,
    entities: overlayPages[pageKey(analysisId, pageNumber)]?.entities ?? [],
    pixelsPerMeter: scaleInfo?.pixelsPerMeter ?? null,
    drawingOcrLines: pageSpaceDrawingOcrLines,
    ocrLinesForTypes: ocrLinesFromPage(page),
  });

  const unitGraphOverlay = useMemo(() => {
    if (inspectorTab !== "graph" || !showGraphOnPlan) return null;
    if (!unitGraphView.unitGraph || !unitGraphView.activeUnit) return null;
    return {
      unitGraph: unitGraphView.unitGraph,
      unitId: unitGraphView.activeUnit.id,
      topology: unitGraphView.activeTopology,
      selectedId: geometrySelectedId,
      onSelect: setGeometrySelectedId,
    };
  }, [
    inspectorTab,
    showGraphOnPlan,
    unitGraphView.unitGraph,
    unitGraphView.activeUnit,
    unitGraphView.activeTopology,
    geometrySelectedId,
    setGeometrySelectedId,
  ]);
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
    const geometrySource = geometryRooms.length ? geometryRooms : (geometryGraph?.nodes ?? []);
    const geometryRoomsByPage: Record<number, typeof geometrySource> = {};
    if (geometryPageKey && geometrySource.length) {
      const suffix = geometryPageKey.slice(analysisId.length + 1);
      const pageNo = Number(suffix);
      if (Number.isFinite(pageNo)) geometryRoomsByPage[pageNo] = geometrySource;
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
      geometryRoomsByPage,
      pixelsPerMeter: scaleInfo?.pixelsPerMeter ?? null,
    });
  }, [
    analysis?.sourceFileName,
    analysisId,
    geometryGraph,
    geometryPageKey,
    geometryRooms,
    overlayPages,
    project?.name,
    projectId,
    result,
    scaleInfo?.pixelsPerMeter,
  ]);

  useEffect(() => {
    if ((inspectorTab === "layout" || inspectorTab === "detect" || inspectorTab === "geometry" || inspectorTab === "graph" || inspectorTab === "review" || inspectorTab === "policy") && toolMode === "none") {
      setOverlayTool("select");
    }
  }, [inspectorTab, toolMode, setOverlayTool]);

  useEffect(() => {
    setPageIndex(0);
    setToolMode("none");
    setMeasurePoints([]);
    const prevAnalysisId = prevAnalysisIdRef.current;
    prevAnalysisIdRef.current = analysisId;
    if (prevAnalysisId != null && prevAnalysisId !== analysisId) {
      setInspectorTab("project");
    }
    setOverlayTool("pan");
    useOverlayStore.getState().clearSelection();
    appliedOcrScaleKeyRef.current = null;
  }, [analysisId, setPageIndex, setOverlayTool]);


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
    drawingOcrMeta: page?.drawingOcrMeta,
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
      const pack = resolveActivePack(projectId, project?.policyVersion);
      const key = pageKey(analysisId, page.pageNumber);
      const entities =
        useOverlayStore.getState().pages[key]?.entities.filter((e) => e.status !== "rejected") ?? [];
      const sheet = computeApartmentSheet({
        hierarchy: liveHierarchy,
        entities,
        pixelsPerMeter: scaleInfo?.pixelsPerMeter,
        levelName: page.levelName,
        ocrLines: [...(page.ocrMeta?.lines ?? []), ...(page.drawingOcrMeta?.lines ?? [])],
      });
      const checks = evaluatePolicyPack({
        pack,
        analysisId,
        sheet,
        hierarchy: liveHierarchy,
        entities,
        roomGraph:
          useGeometryExtractStore.getState().pageKey === key
            ? useGeometryExtractStore.getState().graph
            : null,
      });
      if (ac.signal.aborted) return;
      const current = projectStore.getResult(analysisId) ?? result;
      if (!current) throw new Error("No analysis result to attach compliance to.");
      await projectStore.setResult(analysisId, {
        ...current,
        complianceResults: checks,
        policyVersion: pack.version,
      });
      if (project && project.policyVersion !== pack.version) {
        await projectStore.updateProject(projectId, { policyVersion: pack.version });
      }
      setOverlayTool("select");
    } catch (e) {
      if (isAbortError(e) || ac.signal.aborted) return;
      setPolicyError(e instanceof Error ? e.message : "Policy check failed");
    } finally {
      if (policyAbortRef.current === ac) policyAbortRef.current = null;
      setPolicyBusy(false);
    }
  }, [
    analysisId,
    liveHierarchy,
    page,
    project,
    projectId,
    result,
    scaleInfo?.pixelsPerMeter,
    setOverlayTool,
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

  const handleScaleToolMode = useCallback((mode: ScaleToolMode) => {
    setToolMode(mode);
    setMeasurePoints([]);
    if (mode !== "none") setOverlayTool("pan");
  }, [setOverlayTool]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      if (typing) return;
      if (e.key === "Escape" && toolMode !== "none") {
        e.preventDefault();
        handleScaleToolMode("none");
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "l") {
        e.preventDefault();
        handleScaleToolMode(toolMode === "measure" ? "none" : "measure");
        return;
      }
      if (key === "c") {
        e.preventDefault();
        handleScaleToolMode(toolMode === "calibrate" ? "none" : "calibrate");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleScaleToolMode, toolMode]);

  const handleDeletePage = useCallback(
    async (target: { pageNumber: number }) => {
      if (!result || result.pages.length <= 1) return;
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

  const appendDrawingPagesHook = useAppendDrawingPages({
    analysisId,
    projectId,
    onAdded: ({ firstNewIndex }) => {
      setPageIndex(firstNewIndex);
      setPageImageUrl(null);
    },
  });

  const persistPageOcr = useCallback(
    (pages: NonNullable<typeof result>["pages"]) => {
      if (!result) return;
      void projectStore.setResult(analysisId, { ...result, pages });
    },
    [analysisId, result],
  );

  const handleDeleteOcrLine = useCallback(
    (source: OcrLineSource, index: number) => {
      if (!result || !page) return;
      const pages = result.pages.map((p) => {
        if (p.pageNumber !== page.pageNumber) return p;
        if (source === "title_block") {
          const nextMeta = removeOcrLineAt(p.ocrMeta, index);
          const nextPage = { ...p, ocrMeta: nextMeta };
          return nextMeta ? applyOcrLevelToPage(nextPage, nextMeta) : nextPage;
        }
        return { ...p, drawingOcrMeta: removeOcrLineAt(p.drawingOcrMeta, index) };
      });
      persistPageOcr(pages);
    },
    [page, persistPageOcr, result],
  );

  const handleClearOcrLines = useCallback(
    (view: "all" | "title_block" | "drawing") => {
      if (!result || !page) return;
      const pages = result.pages.map((p) => {
        if (p.pageNumber !== page.pageNumber) return p;
        if (view === "title_block" || view === "all") {
          p = { ...p, ocrMeta: clearOcrLines(p.ocrMeta) };
        }
        if (view === "drawing" || view === "all") {
          p = { ...p, drawingOcrMeta: clearOcrLines(p.drawingOcrMeta) };
        }
        return p;
      });
      persistPageOcr(pages);
    },
    [page, persistPageOcr, result],
  );

  const projectExplorer = (
    <ProjectSidebar
      pages={result?.pages ?? []}
      activePageIndex={pageIndex}
      onSelectPage={setPageIndex}
      onDeletePage={(p) => void handleDeletePage(p)}
      deletingPageNumber={deletingPageNumber}
      pageDeleteError={pageDeleteError}
      onAddPages={(files) => void appendDrawingPagesHook.appendFiles(files)}
      addingPages={appendDrawingPagesHook.busy}
      addPagesError={appendDrawingPagesHook.error}
    />
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
        void projectStore.setResult(analysisId, { ...liveResult, pages }, next);
        setToolMode("none");
        setMeasurePoints([]);
        return;
      }
      void projectStore.setScaleInfo(analysisId, next);
      setToolMode("none");
      setMeasurePoints([]);
    },
    [analysisId, pageIndex, result],
  );

  const handleApplyTwoPointCalibration = useCallback(
    (realLength: number, unit: "m" | "mm") => {
      const liveScale = projectStore.getScaleInfo(analysisId) ?? scaleInfo;
      if (!liveScale || measurePoints.length < 2) return;
      try {
        const next = calibrateFromTwoPoints(liveScale, {
          pointA: measurePoints[0],
          pointB: measurePoints[1],
          realLength,
          realUnit: unit,
        });
        persistScale(next, page?.pageNumber, { applyAllPages: true });
      } catch {
        // Invalid length or coincident points — leave the two-point pick in place.
      }
    },
    [analysisId, measurePoints, page?.pageNumber, persistScale, scaleInfo],
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
            method: "ocr_scale",
            confidence: Math.max(next.confidence, currentPage.ocrMeta?.confidence ?? 0.85),
            scaleLabel: `1:${opts.scaleRatio} @ ${paperCode}`,
          },
          currentPage.pageNumber,
          { applyAllPages: true },
        );
    },
    [analysisId, page, persistScale, scaleInfo],
  );

  const handleApplyScale = useCallback(
    (opts: { scaleRatio: number | null; paper: string }) => {
      const liveScale = projectStore.getScaleInfo(analysisId) ?? scaleInfo;
      if (!page || !liveScale) return;
      const paperCode = (opts.paper || liveScale.paperFromPdf || liveScale.paper || "A4").toUpperCase();
      const scaleRatio = opts.scaleRatio ?? liveScale.scaleRatio;
      if (
        scaleRatio === liveScale.scaleRatio &&
        paperCode === liveScale.paper
      ) {
        return;
      }

      if (scaleRatio) {
        const next = calibrateFromScaleAndPaper(liveScale, {
          scaleRatio,
          paper: paperCode,
          renderWidthPx: page.widthPx,
          renderHeightPx: page.heightPx,
        });
        persistScale(
          {
            ...next,
            paper: paperCode,
            method: "manual_scale_paper",
            scaleLabel: `1:${scaleRatio} @ ${paperCode}`,
          },
          page.pageNumber,
          { applyAllPages: true },
        );
        return;
      }

      persistScale(
        {
          ...liveScale,
          paper: paperCode,
        },
        page.pageNumber,
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

  const extractDigitalPdfText = useCallback(
    async (opts?: {
      allPages?: boolean;
      title?: boolean;
      drawing?: boolean;
    }) => {
      const wantTitle = opts?.title ?? true;
      const wantDrawing = opts?.drawing ?? true;
      if (!wantTitle && !wantDrawing) {
        setDrawingOcrError("Select Title and/or Drawing before running Digital PDF.");
        return;
      }
      const liveResult = projectStore.getResult(analysisId) ?? result;
      if (!liveResult || !analysis) return;
      const sourceFileName = liveResult.sourceFileName || analysis.sourceFileName || "";
      if (sourceFileName && !sourceFileName.toLowerCase().endsWith(".pdf")) {
        setDrawingOcrError("Original file is not a PDF.");
        return;
      }
      const targets = opts?.allPages
        ? liveResult.pages.filter((p) => p.widthPx >= 1 && p.heightPx >= 1)
        : liveResult.pages.filter((p) => p.pageNumber === pageNumber && p.widthPx >= 1 && p.heightPx >= 1);
      if (!targets.length) {
        setDrawingOcrError("No page available for PDF text.");
        return;
      }

      ocrAbortRef.current?.abort();
      const ac = new AbortController();
      ocrAbortRef.current = ac;
      setOcrBusy(true);
      setOcrKind("both");
      setTitleBlockOcrError(null);
      setDrawingOcrError(null);
      setTitleBlockOcrNotice(null);
      setDrawingOcrNotice(null);
      setOcrProgress({
        current: 0,
        total: targets.length,
        pageNumber: targets[0]!.pageNumber,
        phase: "ocr",
      });
      setOcrStatus("Extracting selectable PDF text…");

      try {
        const byPage = new Map<
          number,
          { title: ReturnType<typeof normalizePageOcrMeta>; drawing: ReturnType<typeof normalizePageOcrMeta> }
        >();
        let step = 0;
        let emptyReason: string | null = null;
        for (const p of targets) {
          if (ac.signal.aborted) break;
          step += 1;
          setOcrProgress({
            current: step,
            total: targets.length,
            pageNumber: p.pageNumber,
            phase: "ocr",
          });
          setOcrStatus(`Page ${p.pageNumber} (${step}/${targets.length}): PDF text…`);
          const extracted = await extractPdfPageText({
            analysisId,
            storagePath: analysis.storagePath ?? "",
            sourceFileName,
            pageImagePath: p.imagePath,
            pageNumber: p.pageNumber,
            pageWidthPx: p.widthPx,
            pageHeightPx: p.heightPx,
            rotationDeg: p.rotationDeg,
            signal: ac.signal,
          });
          if (!extracted.lines.length && extracted.emptyReason) {
            emptyReason = extracted.emptyReason;
          }
          const titleCrop = findTitleBlockCrop(analysisId, p.pageNumber, p.widthPx, p.heightPx);
          const drawingCrop = findDrawingAreaCrop(analysisId, p.pageNumber, p.widthPx, p.heightPx);
          if (wantDrawing && !drawingCrop) {
            throw new Error(
              "No drawing zone on this page. Run Auto layout or draw the main drawing area, then use Digital PDF with Drawing checked.",
            );
          }
          const split = {
            title: wantTitle
              ? splitPdfTextByLayoutCrops(
                  extracted.lines,
                  titleCrop,
                  p.widthPx,
                  p.heightPx,
                  null,
                ).title
              : [],
            drawing: wantDrawing
              ? filterPdfTextToDrawingArea(extracted.lines, drawingCrop, p.widthPx, p.heightPx)
              : [],
          };
          const scaleLines = split.title.length > 0 ? split.title : extracted.lines;
          const parsed = normalizePageOcrMeta({
            provider: "pdf-text",
            coordSpace: "page",
            confidence: 1,
            lines: scaleLines,
            textHint: extracted.textHint,
            ocrLineCount: scaleLines.length,
          });
          byPage.set(p.pageNumber, {
            title: wantTitle
              ? {
                  ...parsed,
                  lines: split.title,
                  ocrLineCount: split.title.length,
                  textHint: split.title.map((l) => l.text).join("\n"),
                  unitIds: pickUnitIdsFromOcrMeta({
                    lines: split.title.length ? split.title : scaleLines,
                  }),
                }
              : {
                  provider: "pdf-text",
                  coordSpace: "page",
                  confidence: 1,
                  lines: [],
                  ocrLineCount: 0,
                  textHint: "",
                },
            drawing: wantDrawing
              ? {
                  provider: "pdf-text",
                  coordSpace: "page",
                  confidence: 1,
                  lines: split.drawing,
                  ocrLineCount: split.drawing.length,
                  textHint: split.drawing.map((l) => l.text).join("\n"),
                  unitIds: pickUnitIdsFromOcrMeta({ lines: split.drawing }),
                }
              : {
                  provider: "pdf-text",
                  coordSpace: "page",
                  confidence: 1,
                  lines: [],
                  ocrLineCount: 0,
                  textHint: "",
                },
          });
        }

        if (ac.signal.aborted) {
          setDrawingOcrNotice("PDF text cancelled.");
          return;
        }
        if (byPage.size === 0) {
          throw new Error(emptyReason ?? "No selectable text in this PDF. Use Run OCR for scans.");
        }
        const hasContent = [...byPage.values()].some(
          (pair) =>
            (wantTitle && (pair.title.lines?.length ?? 0) > 0) ||
            (wantDrawing && (pair.drawing.lines?.length ?? 0) > 0),
        );
        if (!hasContent) {
          throw new Error(emptyReason ?? "No selectable text in this PDF. Use Run OCR for scans.");
        }

        const latestPages = liveResult.pages.map((p) => {
          const pair = byPage.get(p.pageNumber);
          if (!pair) return p;
          let next = p;
          if (wantTitle) {
            next = applyOcrLevelToPage(
              {
                ...next,
                scaleSource: pair.title.scaleText ? "title_block_text" : next.scaleSource,
                scaleConfidence: pair.title.confidence ?? next.scaleConfidence,
              },
              pair.title.lines?.length ? pair.title : next.ocrMeta,
            );
            if (pair.title.lines?.length) {
              next = { ...next, ocrMeta: pair.title };
            }
          }
          if (wantDrawing) {
            next = {
              ...next,
              drawingOcrMeta: pair.drawing.lines?.length ? pair.drawing : null,
            };
          }
          return next;
        });

        await projectStore.setResult(analysisId, {
          ...liveResult,
          pages: latestPages,
          modelVersions: {
            ...liveResult.modelVersions,
            ocr: "pdf-text",
          },
        });

        const lineCount = [...byPage.values()].reduce((sum, pair) => {
          let n = 0;
          if (wantTitle) n += pair.title.lines?.length ?? 0;
          if (wantDrawing) n += pair.drawing.lines?.length ?? 0;
          return sum + n;
        }, 0);
        const notice = `Digital PDF: ${byPage.size} page${byPage.size === 1 ? "" : "s"}, ${lineCount} line${lineCount === 1 ? "" : "s"}.`;
        const targetForScale =
          latestPages.find((p) => p.pageNumber === pageNumber && ocrScaleTextForPage(p)) ??
          latestPages.find((p) => ocrScaleTextForPage(p));
        const parsedScale = targetForScale ? ocrScaleTextForPage(targetForScale) : null;
        if (targetForScale && parsedScale) {
          const liveScale = projectStore.getScaleInfo(analysisId) ?? scaleInfo;
          tryApplyOcrScaleForPage(targetForScale, liveScale);
          setTitleBlockOcrNotice(`${notice} Scale detected: ${parsedScale} — scale calibrated.`);
        } else {
          setTitleBlockOcrNotice(notice);
        }
        setDrawingOcrNotice(null);
      } catch (e) {
        if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) {
          setDrawingOcrNotice("PDF text cancelled.");
          return;
        }
        setDrawingOcrError(e instanceof Error ? e.message : "Could not extract PDF text.");
      } finally {
        setOcrBusy(false);
        setOcrKind(null);
        setOcrProgress(null);
        setOcrStatus(null);
        setOcrOverlay(null);
        if (ocrAbortRef.current === ac) ocrAbortRef.current = null;
      }
    },
    [
      analysis,
      analysisId,
      pageNumber,
      result,
      scaleInfo,
      tryApplyOcrScaleForPage,
    ],
  );

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
      const uniquePages = new Set(work.flatMap((item) => item.pages.map((p) => p.pageNumber)));
      const pageHint =
        uniquePages.size === 1
          ? `page ${[...uniquePages][0]}`
          : `${uniquePages.size} pages`;
      setOcrStatus(
        kind === "both"
          ? `Preparing title and drawing OCR for ${pageHint}…`
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
            const { blob: cropped, pixel } = await cropImageBlob(blob, crop);
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
            const ocrOptions = applyOcrResolution(
              useOcrSettingsStore.getState().getOcrOptions(),
              runKind === "page" ? "page" : runKind,
              cropWidthPx,
              cropHeightPx,
            );
            const detHint = ocrOptions.detLimitSideLen ?? ocrOptions.vlMaxSide;
            setOcrStatus(
              kind === "both"
                ? `Page ${p.pageNumber} (${step}/${totalSteps}): ${regionLabel} OCR @ ${detHint}px…`
                : `Page ${p.pageNumber} (${step}/${totalSteps}): OCR ${regionLabel} @ ${detHint}px…`,
            );
            const out = await ocrPageImageStream(
              cropped,
              `page-${p.pageNumber}-${runKind}.png`,
              {
                signal: ac.signal,
                profile: runKind === "drawing" ? "dense" : "default",
                ocrOptions,
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
            const rasterW = out.widthPx > 0 ? out.widthPx : pixel.width;
            const rasterH = out.heightPx > 0 ? out.heightPx : pixel.height;
            const remapped = normalizePageOcrMeta({
              ...scaleOcrBboxes(out.sheet, rasterW, rasterH, pixel.width, pixel.height),
              coordSpace: "crop",
              ocrFrame: ocrFrameFromPixelCrop(pixel, p.widthPx, p.heightPx),
            });
            ocrByPage.set(p.pageNumber, remapped);

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
          ? "Cannot reach the inference API. Keep npm run race:tunnel running for GPU (:8008), or wait for local :8000 from .\\scripts\\dev.ps1."
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

    if (!effectiveScale || !shouldApplyOcrScale(scaleInfo)) return;

    const applyKey = `${attemptKey}:${effectiveScale}`;
    if (appliedOcrScaleKeyRef.current === applyKey) return;
    appliedOcrScaleKeyRef.current = applyKey;
    const applied = applyScaleFromOcrText(effectiveScale, scaleInfo, page, (opts) =>
      handleApplyOcrScale(opts, page),
    );
    if (!applied && appliedOcrScaleKeyRef.current === applyKey) {
      appliedOcrScaleKeyRef.current = null;
    }
  }, [
    analysisId,
    handleApplyOcrScale,
    layoutOcrScaleText,
    page?.ocrMeta?.lines,
    page?.ocrMeta?.scaleText,
    page?.pageNumber,
    page?.widthPx,
    page?.heightPx,
    scaleInfo,
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
                  rotationDeg: normalizeRotation((page.rotationDeg ?? 0) + deg),
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
                  rotationDeg: normalizeRotation((p.rotationDeg ?? 0) + deg),
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

  const handleChangeDpi = useCallback(
    async (nextDpi: number) => {
      if (!analysis?.storagePath || !result?.pages.length || !scaleInfo) return;
      const sourceName = analysis.sourceFileName || "";
      if (!sourceName.toLowerCase().endsWith(".pdf")) {
        setDpiError("DPI can only be changed for PDF drawings.");
        return;
      }
      setDpiBusy(true);
      setDpiError(null);
      setDpiStatus(`Re-rendering at ${nextDpi} DPI…`);
      try {
        const ext = sourceName.toLowerCase().endsWith(".pdf") ? ".pdf" : "";
        const url = await signedPlanUrl(`${analysis.storagePath}/source${ext}`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Could not download the original PDF (${res.status}).`);
        const blob = await res.blob();
        const { putSourcePdf } = await import("@/lib/pdf/sourcePdfStore");
        await putSourcePdf(analysisId, blob);
        const file = new File([blob], sourceName, { type: "application/pdf" });
        const { renderAllPdfPagesToPng } = await import("@/lib/pdf/renderPdfFirstPage");
        const rendered = await renderAllPdfPagesToPng(file, {
          dpi: nextDpi,
          rotationForPage: (pageNumber) =>
            result.pages.find((p) => p.pageNumber === pageNumber)?.rotationDeg ?? 0,
          onProgress: (done, total) => {
            setDpiStatus(`Rendering page ${done} of ${total} at ${nextDpi} DPI…`);
          },
        });
        const byNumber = new Map(rendered.map((p) => [p.pageNumber, p]));
        const nextPages = [];
        for (const oldPage of result.pages) {
          const neu = byNumber.get(oldPage.pageNumber);
          if (!neu) {
            nextPages.push(oldPage);
            continue;
          }
          const png = dataUrlToBlob(neu.dataUrl);
          await putPageImageBlob(analysisId, oldPage.pageNumber, png);
          await uploadPlanObject(
            `${analysis.storagePath}/page-${oldPage.pageNumber}.png`,
            png,
            "image/png",
          );
          const sx = oldPage.widthPx > 0 ? neu.widthPx / oldPage.widthPx : 1;
          const sy = oldPage.heightPx > 0 ? neu.heightPx / oldPage.heightPx : 1;
          const key = pageKey(analysisId, oldPage.pageNumber);
          const entities = useOverlayStore.getState().pages[key]?.entities ?? [];
          const nextEntities = entities.map((entity) => scaleOverlayEntity(entity, sx, sy));
          useOverlayStore.getState().loadPageEntities(nextEntities, {
            analysisId,
            pageNumber: oldPage.pageNumber,
          });
          await projectStore.setOverlays(analysisId, oldPage.pageNumber, nextEntities);
          const ocrMeta = oldPage.ocrMeta
            ? (scaleSheetOcrMeta(
                oldPage.ocrMeta,
                oldPage.widthPx,
                oldPage.heightPx,
                neu.widthPx,
                neu.heightPx,
              ) as typeof oldPage.ocrMeta)
            : oldPage.ocrMeta;
          const drawingOcrMeta = oldPage.drawingOcrMeta
            ? (scaleSheetOcrMeta(
                oldPage.drawingOcrMeta,
                oldPage.widthPx,
                oldPage.heightPx,
                neu.widthPx,
                neu.heightPx,
              ) as typeof oldPage.drawingOcrMeta)
            : oldPage.drawingOcrMeta;
          nextPages.push({
            ...oldPage,
            widthPx: neu.widthPx,
            heightPx: neu.heightPx,
            ocrMeta,
            drawingOcrMeta,
          });
        }
        const first = nextPages[0];
        let pixelsPerMeter = scaleInfo.pixelsPerMeter;
        if (scaleInfo.scaleRatio && scaleInfo.paper && first) {
          try {
            pixelsPerMeter = pixelsPerMeterFromScaleAndPaper({
              scaleRatio: scaleInfo.scaleRatio,
              paper: scaleInfo.paper,
              renderWidthPx: first.widthPx,
              renderHeightPx: first.heightPx,
            });
          } catch {
            const oldFirst = result.pages[0];
            if (oldFirst?.widthPx && pixelsPerMeter) {
              pixelsPerMeter = pixelsPerMeter * (first.widthPx / oldFirst.widthPx);
            }
          }
        } else if (pixelsPerMeter && result.pages[0]?.widthPx && first) {
          pixelsPerMeter = pixelsPerMeter * (first.widthPx / result.pages[0].widthPx);
        }
        const nextScale = { ...scaleInfo, pixelsPerMeter };
        const mPerPx =
          nextScale.pixelsPerMeter && nextScale.pixelsPerMeter > 0
            ? 1 / nextScale.pixelsPerMeter
            : undefined;
        await projectStore.setResult(analysisId, {
          ...result,
          pages: nextPages.map((p) => ({
            ...p,
            scaleMPerPixel: mPerPx,
            scaleSource: nextScale.method,
            scaleConfidence: nextScale.confidence,
          })),
        });
        await projectStore.setScaleInfo(analysisId, nextScale);
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
        setDpiStatus(null);
      } catch (e) {
        setDpiError(e instanceof Error ? e.message : "Could not change DPI.");
      } finally {
        setDpiBusy(false);
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
      <WorkspaceShell>
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
      <WorkspaceShell>
        <div className="flex h-full items-center justify-center text-sm text-slate-500">
          Loading drawing…
        </div>
      </WorkspaceShell>
    );
  }

  const scaleLabel =
    scaleInfo?.pixelsPerMeter != null
      ? scaleInfo.scaleRatio != null
        ? `1:${scaleInfo.scaleRatio}${scaleInfo.paper ? ` @ ${scaleInfo.paper}` : ""}`
        : `${scaleInfo.pixelsPerMeter.toFixed(1)} px/m`
      : "Scale unknown";
  const graphicsLabel = page?.graphicsKind ? pdfGraphicsLabel(page.graphicsKind) : null;
  const pageStatus =
    pageCount > 0 ? `Page ${pageIndex + 1} of ${pageCount}` : "No pages";
  const renderDpi = inferRenderDpi(
    page?.widthPx ?? 0,
    page?.heightPx ?? 0,
    scaleInfo?.pageWidthPt ?? 0,
    scaleInfo?.pageHeightPt ?? 0,
  );
  const canChangeDpi = Boolean(
    analysis.storagePath &&
      (analysis.sourceFileName || "").toLowerCase().endsWith(".pdf") &&
      page?.graphicsKind !== "image",
  );

  const inspectorTabs = [
    { id: "project", label: "Project", title: "Projects and drawings" },
    { id: "layout", label: "Layout", title: "Sheet zones" },
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
    {
      id: "detect",
      label: "Detect",
      title: "Region detection",
      badge: detection.regionCount > 0 ? detection.regionCount : null,
    },
    {
      id: "geometry",
      label: "Geometry",
      title: "Extract rooms from overlays or the page image",
      badge:
        geometryPageKey === pageKey(analysisId, pageNumber) && geometryRoomCount > 0
          ? geometryRoomCount
          : null,
    },
    {
      id: "graph",
      label: "Graph",
      title: "Adjacency graph and apartment topology",
      badge:
        geometryPageKey === pageKey(analysisId, pageNumber) && geometryRoomCount > 0
          ? geometryRoomCount
          : null,
    },
    {
      id: "hierarchy",
      label: "Tree",
      title: "Building hierarchy",
      badge: liveHierarchy?.units.length ? liveHierarchy.units.length : null,
    },
    {
      id: "policy",
      label: "Policy",
      title: "Design policy packs and compliance",
      badge: result?.complianceResults.length ? result.complianceResults.length : null,
    },
    {
      id: "review",
      label: "Review",
      title: "Units, policy, and export",
      badge:
        (result?.complianceResults.length ?? 0) > 0
          ? result!.complianceResults.length
          : (result?.unitSummaries.length ?? 0) > 0
            ? result!.unitSummaries.length
            : null,
    },
  ];

  const handleInspectorTabChange = (id: string) => {
    const tab = id as InspectorTabId;
    setInspectorTab(tab);
    if (tab === "project") return;
    if (tab === "geometry") {
      useGeometryExtractStore.getState().setShowOverlays(true);
    }
    if (tab === "graph") {
      useGeometryExtractStore.getState().setShowGraphOnPlan(true);
    }
    if (toolMode !== "none") return;
    if (tab === "layout" || tab === "review" || tab === "policy" || tab === "geometry" || tab === "graph") {
      setOverlayTool("select");
      setLayoutDrawType(null);
    } else {
      setOverlayTool("select");
      setLayoutDrawType(null);
    }
  };

  const inspectorTitle =
    inspectorTab === "project"
      ? "Project"
      : inspectorTab === "layout"
        ? "Layout"
        : inspectorTab === "ocr"
          ? "PaddleOCR"
          : inspectorTab === "detect"
            ? "Detect"
            : inspectorTab === "geometry"
              ? "Geometry"
              : inspectorTab === "graph"
                ? "Graph"
                : inspectorTab === "policy"
                  ? "Policy"
                  : inspectorTab === "review"
                    ? "Review"
                    : "Hierarchy";

  return (
    <WorkspaceShell
      inspectorHasRail
      projectPanel={projectExplorer}
      statusText={[pageStatus, graphicsLabel, scaleLabel].filter(Boolean).join(" · ")}
      toolbarPinned={toolMode !== "none" || rotating || dpiBusy}
      toolbar={
        <EditorToolbar
          pageCount={pageCount}
          onRotateCw={() => void handleRotatePage(90)}
          onRotateCcw={() => void handleRotatePage(270)}
          onRotateAllCw={() => void handleRotateAllPages(90)}
          onRotateAllCcw={() => void handleRotateAllPages(270)}
          rotating={rotating || dpiBusy}
          rotateStatus={rotateStatus ?? dpiStatus}
          scaleTools={{
            mode: toolMode,
            onModeChange: handleScaleToolMode,
            measureLabel:
              measureLabel ??
              (toolMode === "measure" && measurePoints.length >= 2
                ? `${pixelDistance(measurePoints[0], measurePoints[1]).toFixed(1)} px`
                : null),
            calibrateReady: toolMode === "calibrate" && measurePoints.length >= 2,
            onApplyCalibration: handleApplyTwoPointCalibration,
          }}
        />
      }
      sidebar={
        <AnalysisRightSidebar
          drawingInfo={
            scaleInfo ? (
              <ScalePanel
                scaleInfo={scaleInfo}
                compact
                graphicsKind={page?.graphicsKind}
                widthPx={page?.widthPx}
                heightPx={page?.heightPx}
                renderDpi={renderDpi}
                canChangeDpi={canChangeDpi}
                dpiBusy={dpiBusy}
                dpiStatus={dpiStatus}
                dpiError={dpiError}
                onApplyDpi={(dpi) => void handleChangeDpi(dpi)}
                onApplyScale={handleApplyScale}
              />
            ) : (
              <p className="text-xs text-slate-500">No scale data available.</p>
            )
          }
          overlayView={
            <OverlayViewSection
              hasOcr={
                ((page?.ocrMeta?.ocrLineCount ?? page?.ocrMeta?.lines?.length ?? 0) +
                  (page?.drawingOcrMeta?.ocrLineCount ??
                    page?.drawingOcrMeta?.lines?.length ??
                    0)) >
                0
              }
            />
          }
        />
      }
      inspectorTitle={inspectorTitle}
      inspector={
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
        <VerticalInspectorTabs
          tabs={inspectorTabs}
          activeId={inspectorTab}
          onChange={handleInspectorTabChange}
        >
          {inspectorTab === "project" ? (
            projectExplorer
          ) : inspectorTab === "layout" ? (
            <div className="space-y-3">
              <ManualLayoutPanel
                analysisId={analysisId}
                pageNumber={page?.pageNumber ?? 1}
                pageWidthPx={page?.widthPx ?? 0}
                pageHeightPx={page?.heightPx ?? 0}
                pageCount={pageCount}
                disabled={ocrBusy || detection.detecting || !pageImageUrl}
                detectBusy={detection.detecting}
                detectLabel={detection.progress?.label}
                detectProgress={
                  detection.progress
                    ? {
                        index: detection.progress.index,
                        total: detection.progress.batchTotal ?? detection.progress.total,
                      }
                    : null
                }
                detectError={detection.detectError}
                detectWarning={detection.detectWarning}
                onAutoLayout={(scope) => {
                  if (scope === "all") void detection.runLayoutDetectAllPages();
                  else void detection.runLayoutDetect();
                }}
                onCancelDetect={() => detection.cancelDetect()}
              />
            </div>
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
                graphicsKind={page?.graphicsKind}
                onRunPageOcr={(profile) => void runPageOcr(profile)}
                onRunTitleBlockOcr={() => void runTitleBlockOcr([pageNumber], true)}
                onRunDrawingAreaOcr={() => void runDrawingAreaOcr([pageNumber])}
                onRunAllPagesOcr={() => void runAllPagesOcr()}
                onRunOcr={({ title, drawing, allPages }) => {
                  const run = ocrRunFromChecks({
                    title,
                    drawing,
                    allPages,
                    pageNumber,
                  });
                  if (run) void runLayoutRegionOcr(run.kind, run);
                }}
                onExtractPdfText={(opts) => void extractDigitalPdfText(opts)}
                onCancelOcr={cancelOcr}
                onDeleteOcrLine={handleDeleteOcrLine}
                onClearOcrLines={handleClearOcrLines}
                activeScaleLabel={scaleLabel}
                scaleMethod={scaleInfo ? scaleMethodLabel(scaleInfo.method) : null}
                onApplyDetectedScale={
                  layoutOcrScaleText || page?.ocrMeta?.scaleText
                    ? () => {
                        const text = layoutOcrScaleText || page?.ocrMeta?.scaleText;
                        if (!text || !page) return false;
                        try {
                          return applyScaleFromOcrText(text, scaleInfo, page, (opts) =>
                            handleApplyOcrScale(opts, page),
                          );
                        } catch {
                          return false;
                        }
                      }
                    : undefined
                }
              />
            ) : inspectorTab === "hierarchy" ? (
              <HierarchyPanel
                hierarchy={liveHierarchy}
                activePageNumber={pageNumber}
                selectedId={selectedIds[0] ?? null}
                entities={overlayPages[pageKey(analysisId, pageNumber)]?.entities ?? []}
                pixelsPerMeter={scaleInfo?.pixelsPerMeter ?? null}
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
                onAddUnit={(pageNumber, raw) => {
                  if (!result) return false;
                  if (!parseManualUnitIds(raw).length) return false;
                  const pages = result.pages.map((p) =>
                    p.pageNumber === pageNumber ? addManualUnitIds(p, raw) : p,
                  );
                  void projectStore.setResult(analysisId, { ...result, pages });
                  return true;
                }}
                onRemoveUnit={(pageNumber, label) => {
                  if (!result) return;
                  const pages = result.pages.map((p) =>
                    p.pageNumber === pageNumber ? removeManualUnitId(p, label) : p,
                  );
                  void projectStore.setResult(analysisId, { ...result, pages });
                }}
              />
            ) : inspectorTab === "policy" ? (
              <PolicyPanel
                projectId={projectId}
                checks={result?.complianceResults ?? []}
                apartmentCount={liveHierarchy?.units.length ?? 0}
                onRunCheck={() => void runPolicyCheck()}
                onCancelCheck={cancelPolicyCheck}
                busy={policyBusy}
                error={policyError}
              />
            ) : inspectorTab === "review" ? (
              <ReviewPanel
                projectId={projectId}
                result={result}
                hierarchy={liveHierarchy}
                entities={overlayPages[pageKey(analysisId, pageNumber)]?.entities ?? []}
                pixelsPerMeter={scaleInfo?.pixelsPerMeter ?? null}
                levelName={page?.levelName}
                ocrLines={[...(page?.ocrMeta?.lines ?? []), ...(page?.drawingOcrMeta?.lines ?? [])]}
                selectedId={selectedIds[0] ?? null}
                onSelect={(ids) => selectOverlay(ids)}
                onPolicy={() => void runPolicyCheck()}
                onCancelPolicy={cancelPolicyCheck}
                policyBusy={policyBusy}
                policyError={policyError}
              />
            ) : inspectorTab === "detect" ? (
              <DetectPanel
                modelId={detection.detectModelId}
                onChangeModel={detection.selectDetectModel}
                detecting={detection.detecting}
                detectTask={detection.detectTask}
                autoDetect={detection.autoDetect}
                onAutoDetectChange={detection.setAutoDetect}
                onRun={() => void detection.runDetect()}
                onRunModel={(id, cat) => void detection.runDetectModel(id, cat)}
                onRunAll={() => void detection.runDetectAll()}
                familyCounts={detection.familyCounts}
                onCancel={() => detection.cancelDetect()}
                progress={detection.progress}
                detectError={detection.detectError}
                detectWarning={detection.detectWarning}
                regionCount={detection.regionCount}
                modelLabel={detection.modelLabel}
                onInferUnits={() => {
                  if (!page) return;
                  const r = applyUnitBoundariesFromPage({
                    analysisId,
                    pageNumber: page.pageNumber,
                    widthPx: page.widthPx,
                    heightPx: page.heightPx,
                    drawingOcrMeta: page.drawingOcrMeta,
                  });
                  setUnitInferNotice(
                    r.created || r.labeled
                      ? `Inferred ${r.created} unit${r.created === 1 ? "" : "s"}${
                          r.labeled ? ` · labelled ${r.labeled}` : ""
                        }`
                      : "Run Detect and drawing OCR first",
                  );
                }}
                unitInferNotice={unitInferNotice}
                inferDisabled={!page}
                onPolicy={() => void runPolicyCheck()}
                onCancelPolicy={cancelPolicyCheck}
                policyBusy={policyBusy}
                policyError={policyError}
                policyCount={result?.complianceResults?.length ?? 0}
                onOpenReview={() => {
                  setInspectorTab("review");
                  setOverlayTool("select");
                }}
              />
            ) : inspectorTab === "geometry" ? (
              <GeometryPanel
                analysisId={analysisId}
                pageNumber={pageNumber}
                widthPx={page?.widthPx ?? 0}
                heightPx={page?.heightPx ?? 0}
                entities={overlayPages[pageKey(analysisId, pageNumber)]?.entities ?? []}
                pixelsPerMeter={scaleInfo?.pixelsPerMeter ?? null}
                pageImageUrl={pageImageUrl}
                drawingOcrLines={pageSpaceDrawingOcrLines}
              />
            ) : inspectorTab === "graph" ? (
              <GraphPanel
                analysisId={analysisId}
                pageNumber={pageNumber}
                entities={overlayPages[pageKey(analysisId, pageNumber)]?.entities ?? []}
                pixelsPerMeter={scaleInfo?.pixelsPerMeter ?? null}
                drawingOcrLines={pageSpaceDrawingOcrLines}
                ocrLinesForTypes={ocrLinesFromPage(page)}
              />
            ) : null}
        </VerticalInspectorTabs>
        </div>
      }
    >
      <div className="flex h-full min-h-0 flex-col bg-[var(--hl-panel)]">
        <OverlayHotkeys
          enabled={toolMode === "none"}
          layoutEditMode={inspectorTab === "layout"}
          keepSelectOnEscape={inspectorTab === "detect" || inspectorTab === "geometry" || inspectorTab === "graph"}
          compassKeypoints={inspectorTab === "detect"}
        />
        {rotateError ? (
          <p className="border-b border-red-100 bg-red-50 px-3 py-1 text-[13px] text-red-700">
            {rotateError}
          </p>
        ) : null}

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
            ocrRoomMarkers={ocrRoomMarkers}
            unitGraphOverlay={unitGraphOverlay}
            showOcrToggle={true}
            layoutEditMode={inspectorTab === "layout" && toolMode === "none"}
            pixelsPerMeter={scaleInfo?.pixelsPerMeter ?? null}
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
