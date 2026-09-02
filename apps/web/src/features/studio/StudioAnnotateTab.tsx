"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { WorkspaceShell } from "@/components/shell/WorkspaceShell";
import { AnnotationPanel } from "@/features/plan-editor/AnnotationPanel";
import { EditorToolbar } from "@/features/plan-editor/EditorToolbar";
import { OverlayHotkeys } from "@/features/plan-editor/OverlayHotkeys";
import { overlaysToLabelMe, parseLabelMeJson } from "@/features/plan-editor/labelme";
import {
  applyLabeledPage,
  buildPageLabelDoc,
  labelShapesFingerprint,
  pageSaveKey,
  type AnnotateSaveStatus,
} from "@/features/studio/studioLabelSave";
import { extraClassesFromDataset, mergeAnnotateClasses } from "@/features/plan-editor/labelClasses";
import { pageKey, useOverlayStore } from "@/features/plan-editor/useOverlayStore";
import { PdfPageViewer } from "@/features/plan-viewer/PdfPageViewer";
import { useLayoutStore } from "@/features/plan-viewer/useLayoutStore";
import { useViewerStore } from "@/features/plan-viewer/useViewerStore";
import {
  addDatasetClass,
  fetchPageLabels,
  getDataset,
  listDatasets,
  saveDatasetPageLabels,
  studioExportZipUrl,
  studioPageImageUrl,
} from "@/lib/studio/studioClient";
import type { MlDataset, StudioPage } from "@/lib/studio/types";

interface StudioAnnotateTabProps {
  activityRail?: ReactNode;
  initialDatasetId?: string;
  onOpenTrain?: (datasetId: string) => void;
  onManageDatasets?: (datasetId?: string) => void;
  onOpenTiles?: (datasetId: string) => void;
}

function isFullPage(page: StudioPage): boolean {
  if ((page.kind || "") === "tile") return false;
  if (/_tile\d+/i.test(page.source_name || "")) return false;
  return true;
}

export function StudioAnnotateTab({
  activityRail,
  initialDatasetId,
  onOpenTrain,
  onManageDatasets,
  onOpenTiles,
}: StudioAnnotateTabProps) {
  const resetView = useViewerStore((s) => s.resetView);
  const pageIndex = useViewerStore((s) => s.pageIndex);
  const setPageIndex = useViewerStore((s) => s.setPageIndex);
  const setOverlayTool = useOverlayStore((s) => s.setTool);
  const setOverlayContext = useOverlayStore((s) => s.setContext);

  const [datasets, setDatasets] = useState<MlDataset[]>([]);
  const [datasetId, setDatasetId] = useState(initialDatasetId || "");
  const [dataset, setDataset] = useState<MlDataset | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [addClassError, setAddClassError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<AnnotateSaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const suppressSaveRef = useRef(false);
  const lastSavedRef = useRef<Record<string, string>>({});
  const inflightRef = useRef<Map<string, Promise<void>>>(new Map());
  const saveStatusRef = useRef<AnnotateSaveStatus>("idle");
  saveStatusRef.current = saveStatus;

  const pages = useMemo(
    () => (dataset?.pages ?? []).filter(isFullPage),
    [dataset?.pages],
  );
  const page: StudioPage | undefined = pages[pageIndex];
  const overlayPageNumber = pageIndex + 1;

  const extraClasses = useMemo(
    () => extraClassesFromDataset(dataset?.class_names ?? []),
    [dataset?.class_names],
  );
  const annotateClassOptions = useMemo(
    () => mergeAnnotateClasses(dataset?.class_names ?? []),
    [dataset?.class_names],
  );

  const handleAddClass = useCallback(
    async (name: string) => {
      if (!datasetId) return;
      setAddClassError(null);
      try {
        const next = await addDatasetClass(datasetId, name);
        setDataset(next);
        useOverlayStore.getState().setLabelClass(name);
      } catch (e) {
        setAddClassError(e instanceof Error ? e.message : "Could not add class.");
        throw e;
      }
    },
    [datasetId],
  );

  const refreshDatasets = useCallback(
    async (selectId?: string) => {
      const next = await listDatasets();
      setDatasets(next);
      const id = selectId || datasetId || next[0]?.id || "";
      setDatasetId(id);
      if (id) {
        setDataset(await getDataset(id));
      } else {
        setDataset(null);
      }
    },
    [datasetId],
  );

  const persistFor = useCallback(
    async (
      dsId: string,
      target: StudioPage,
      pn: number,
      options?: { keepalive?: boolean },
    ) => {
      const key = pageSaveKey(dsId, target.id);
      const run = async () => {
        // Do not write until this page has been hydrated from disk (avoids wiping JSON
        // on React Strict Mode remount or while labels are still loading).
        if (lastSavedRef.current[key] === undefined) return;
        const entities = useOverlayStore.getState().pages[pageKey(dsId, pn)]?.entities ?? [];
        const doc = buildPageLabelDoc(entities, target);
        const fingerprint = labelShapesFingerprint(doc.shapes);
        if (fingerprint === lastSavedRef.current[key]) {
          setSaveStatus((current) => (current === "unsaved" || current === "saving" ? "saved" : current));
          return;
        }
        setSaveStatus("saving");
        setSaveError(null);
        try {
          const updated = await saveDatasetPageLabels(dsId, target.id, doc, {
            keepalive: options?.keepalive === true,
          });
          lastSavedRef.current[key] = fingerprint;
          setSaveStatus("saved");
          setDataset((current) => (current ? applyLabeledPage(current, updated) : current));
        } catch (e) {
          setSaveStatus("error");
          setSaveError(e instanceof Error ? e.message : "Could not save labels.");
        }
      };
      const prev = inflightRef.current.get(key) ?? Promise.resolve();
      const next = prev.then(run, run);
      inflightRef.current.set(key, next);
      try {
        await next;
      } finally {
        if (inflightRef.current.get(key) === next) inflightRef.current.delete(key);
      }
    },
    [],
  );

  const persistPageLabels = useCallback(
    async (options?: { keepalive?: boolean }) => {
      if (!datasetId || !page) return;
      await persistFor(datasetId, page, overlayPageNumber, options);
    },
    [datasetId, overlayPageNumber, page, persistFor],
  );

  const goToPage = useCallback(
    async (index: number) => {
      await persistPageLabels();
      setPageIndex(index);
    },
    [persistPageLabels, setPageIndex],
  );

  const changeDataset = useCallback(
    async (id: string) => {
      await persistPageLabels();
      setDatasetId(id);
    },
    [persistPageLabels],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoadError(null);
        await refreshDatasets(initialDatasetId || undefined);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load local datasets.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!datasetId) {
      setDataset(null);
      return;
    }
    let cancelled = false;
    void getDataset(datasetId)
      .then((next) => {
        if (!cancelled) setDataset(next);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not open dataset.");
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  const isNorthCompass = dataset?.category === "north_arrow";

  useEffect(() => {
    useLayoutStore.getState().setInspectorOpen(true);
  }, []);

  useEffect(() => {
    setPageIndex(0);
    setOverlayTool(isNorthCompass ? "rect" : "polygon");
    if (isNorthCompass) useOverlayStore.getState().setLabelClass("North Arrow");
    resetView();
  }, [datasetId, isNorthCompass, resetView, setOverlayTool, setPageIndex]);

  useEffect(() => {
    if (pages.length > 0 && pageIndex >= pages.length) setPageIndex(pages.length - 1);
  }, [pageIndex, pages.length, setPageIndex]);

  useEffect(() => {
    if (!datasetId) return;
    setOverlayContext(datasetId, overlayPageNumber);
  }, [datasetId, overlayPageNumber, setOverlayContext]);

  useEffect(() => {
    if (!datasetId || !page) return;
    let cancelled = false;
    const pageId = page.id;
    const key = pageSaveKey(datasetId, pageId);
    void (async () => {
      const pending = inflightRef.current.get(key);
      if (pending) await pending;
      if (cancelled) return;
      const raw = await fetchPageLabels(datasetId, pageId);
      if (cancelled) return;
      // Mark as hydrate so autosave does not immediately PUT the same labels.
      suppressSaveRef.current = true;
      if (!raw) {
        useOverlayStore.getState().loadPageEntities([], {
          analysisId: datasetId,
          pageNumber: overlayPageNumber,
        });
        lastSavedRef.current[key] = "[]";
        setSaveStatus("saved");
        return;
      }
      const parsed = parseLabelMeJson(raw);
      useOverlayStore.getState().loadPageEntities(parsed.entities, {
        analysisId: datasetId,
        pageNumber: overlayPageNumber,
      });
      lastSavedRef.current[key] = labelShapesFingerprint(buildPageLabelDoc(parsed.entities, page).shapes);
      setSaveStatus("saved");
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Intentionally depend on page.id only — page object identity changes after every save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, overlayPageNumber, page?.id]);

  useEffect(() => {
    if (!datasetId || !page) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const key = pageKey(datasetId, overlayPageNumber);
    const target = page;
    const dsId = datasetId;
    const pn = overlayPageNumber;

    const unsub = useOverlayStore.subscribe((state, prev) => {
      // Ignore selection / draft / history noise — only entity list changes matter.
      if (state.pages[key]?.entities === prev.pages[key]?.entities) return;
      if (suppressSaveRef.current) {
        suppressSaveRef.current = false;
        return;
      }
      const prevEntities = prev.pages[key]?.entities;
      const nextEntities = state.pages[key]?.entities ?? [];
      if (prevEntities === undefined && nextEntities.length === 0) return;

      setSaveStatus("unsaved");
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void persistFor(dsId, target, pn);
      }, 400);
    });

    const flush = () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      void persistFor(dsId, target, pn, { keepalive: true });
    };

    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (
        saveStatusRef.current === "unsaved" ||
        saveStatusRef.current === "saving" ||
        saveStatusRef.current === "error"
      ) {
        e.preventDefault();
        e.returnValue = "";
        flush();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("beforeunload", onUnload);

    return () => {
      unsub();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("beforeunload", onUnload);
      if (timer) clearTimeout(timer);
      void persistFor(dsId, target, pn, { keepalive: true });
    };
    // page identity changes after each successful save; key off id + size only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, overlayPageNumber, page?.id, page?.width_px, page?.height_px, persistFor]);

  const handleImportLabelMe = useCallback(
    async (file: File) => {
      if (!datasetId || !page) return;
      setImportError(null);
      try {
        const parsed = parseLabelMeJson(JSON.parse(await file.text()) as unknown);
        useOverlayStore.getState().replaceHumanEntities(parsed.entities, {
          analysisId: datasetId,
          pageNumber: overlayPageNumber,
        });
        const all =
          useOverlayStore.getState().pages[pageKey(datasetId, overlayPageNumber)]?.entities ??
          parsed.entities;
        const doc = overlaysToLabelMe(all, {
          imagePath: `${page.id}.png`,
          imageWidth: page.width_px,
          imageHeight: page.height_px,
        });
        const updated = await saveDatasetPageLabels(datasetId, page.id, doc);
        lastSavedRef.current[pageSaveKey(datasetId, page.id)] = labelShapesFingerprint(doc.shapes);
        setSaveStatus("saved");
        setSaveError(null);
        setDataset((current) => (current ? applyLabeledPage(current, updated) : current));
      } catch (e) {
        setImportError(e instanceof Error ? e.message : "Could not import LabelMe JSON.");
      }
    },
    [datasetId, overlayPageNumber, page],
  );

  const handleExportLabelMe = useCallback(() => {
    if (!datasetId || !page) return;
    const entities =
      useOverlayStore.getState().pages[pageKey(datasetId, overlayPageNumber)]?.entities ?? [];
    const doc = overlaysToLabelMe(entities, {
      imagePath: `${page.id}.png`,
      imageWidth: page.width_px,
      imageHeight: page.height_px,
    });
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${page.source_name.replace(/\.[^.]+$/, "")}-p${page.page_number}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [datasetId, overlayPageNumber, page]);

  const pageImageUrl =
    datasetId && page
      ? `${studioPageImageUrl(datasetId, page.id)}?v=${page.width_px}x${page.height_px}`
      : null;

  return (
    <WorkspaceShell
      hideTopBar
      allowNewProjectShortcut={false}
      activityRail={activityRail}
      leftPanelTitle="Pages"
      leftPanel={
        <div className="space-y-1.5">
          <button
            type="button"
            className="w-full text-left text-xs text-brand-700 hover:underline"
            onClick={() => onManageDatasets?.(datasetId || undefined)}
          >
            Datasets →
          </button>
          {datasetId ? (
            <button
              type="button"
              className="w-full text-left text-xs text-brand-700 hover:underline"
              onClick={() => onOpenTiles?.(datasetId)}
            >
              Tiles →
            </button>
          ) : null}
          {pages.length === 0 ? (
            <p className="px-0.5 text-xs leading-relaxed text-slate-500">
              No pages yet. Upload in Datasets.
            </p>
          ) : (
            <ul className="space-y-1">
              {pages.map((item, index) => {
                const active = index === pageIndex;
                const thumb = datasetId
                  ? `${studioPageImageUrl(datasetId, item.id)}?thumb=1&v=${item.width_px}x${item.height_px}`
                  : "";
                const meta = [
                  `p${item.page_number}`,
                  (item.split || "train") === "test" ? "test" : "train",
                  item.labeled ? "✓" : null,
                  item.shape_count ? String(item.shape_count) : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => void goToPage(index)}
                      title={`${item.source_name} · ${meta}`}
                      className={
                        active
                          ? "relative w-full overflow-hidden rounded border border-brand-400 bg-brand-50 text-left ring-1 ring-brand-400/40"
                          : "relative w-full overflow-hidden rounded border border-slate-200 bg-white text-left hover:border-slate-300"
                      }
                    >
                      <div className="h-14 bg-slate-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={thumb}
                          alt=""
                          className="h-full w-full object-contain object-top"
                          loading="lazy"
                        />
                      </div>
                      <span
                        className={
                          active
                            ? "absolute inset-x-0 bottom-0 bg-brand-800/85 px-1 py-0 text-center text-xs font-medium text-white"
                            : "absolute inset-x-0 bottom-0 bg-black/65 px-1 py-0 text-center text-xs font-medium text-white"
                        }
                      >
                        {item.page_number}
                        {item.labeled ? " · ✓" : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      }
      inspectorTitle="Labels"
      inspectorHint="Legend, new classes, import/export JSON, and shape inspector. Select a shape to edit its class or drag vertices on the canvas."
      leftPanelHint="Upload pages in Datasets, then pick a sheet here to label."
      inspector={
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3">
          {page ? (
            <>
              <AnnotationPanel
                includeLayoutClasses={!isNorthCompass}
                compassAnnotate={isNorthCompass}
                extraClasses={extraClasses}
                onAddClass={datasetId ? handleAddClass : undefined}
                addClassError={addClassError}
                onImportFile={(file) => void handleImportLabelMe(file)}
                onExport={handleExportLabelMe}
                onSave={() => void persistPageLabels()}
                saveStatus={saveStatus}
                saveError={saveError}
                importError={importError}
              />
            </>
          ) : (
            <p className="text-[13px] text-slate-500">Select a page to edit labels.</p>
          )}
        </div>
      }
    >
      <div className="flex h-full min-h-0 max-h-full flex-col overflow-hidden bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs">
          <label className="flex items-center gap-1.5 text-slate-600">
            Dataset
            <select
              className="max-w-[14rem] rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-800"
              value={datasetId}
              onChange={(e) => void changeDataset(e.target.value)}
            >
              {datasets.length === 0 ? <option value="">No datasets</option> : null}
              {datasets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.labeled_count}/{item.image_count})
                </option>
              ))}
            </select>
          </label>
          {page ? (
            <span className="truncate text-slate-500">
              {page.source_name} · p{page.page_number}
              {(page.split || "train") === "test" ? " · test" : " · train"}
            </span>
          ) : null}
          {page ? (
            <button
              type="button"
              className={
                saveStatus === "error"
                  ? "rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                  : saveStatus === "unsaved"
                    ? "rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                    : "rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              }
              disabled={saveStatus === "saving" || saveStatus === "idle"}
              onClick={() => void persistPageLabels()}
            >
              {saveStatus === "saving"
                ? "Saving…"
                : saveStatus === "saved"
                  ? "Saved"
                  : saveStatus === "error"
                    ? "Retry save"
                    : "Save"}
            </button>
          ) : null}
          {dataset && dataset.labeled_count > 0 ? (
            <>
              <a href={studioExportZipUrl(dataset.id)} className="text-brand-700 hover:underline">
                Export ZIP
              </a>
              <button
                type="button"
                className="text-brand-700 hover:underline"
                onClick={() => onOpenTiles?.(dataset.id)}
              >
                View tiles
              </button>
              <button
                type="button"
                className="text-brand-700 hover:underline"
                onClick={() => onOpenTrain?.(dataset.id)}
              >
                Fine-tune
              </button>
            </>
          ) : null}
        </div>
        {page && pageImageUrl ? (
          <div className="border-b border-slate-200 bg-white px-2 py-1">
            <EditorToolbar
              showDrawTools
              compassKeypoints={isNorthCompass}
              classOptions={annotateClassOptions}
            />
          </div>
        ) : null}
        {loadError ? (
          <p className="border-b border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{loadError}</p>
        ) : null}
        {importError ? (
          <p className="border-b border-red-100 bg-red-50 px-3 py-1 text-[13px] text-red-700">
            {importError}
          </p>
        ) : null}
        {saveError ? (
          <p className="border-b border-red-100 bg-red-50 px-3 py-1 text-[13px] text-red-700">{saveError}</p>
        ) : null}
        {page && pageImageUrl && page.width_px > 0 && page.height_px > 0 ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <OverlayHotkeys
              enabled
              allowDraw
              compassKeypoints={isNorthCompass}
              onSave={() => void persistPageLabels()}
            />
            <PdfPageViewer
              key={`${page.id}-${page.width_px}x${page.height_px}`}
              imagePath={pageImageUrl}
              widthPx={page.width_px}
              heightPx={page.height_px}
              toolMode="none"
              overlayMode="annotate"
              showLoupeToggle
            />
          </div>
        ) : page && pageImageUrl ? (
          <LinkedPageLoader
            datasetId={datasetId}
            page={page}
            imageUrl={pageImageUrl}
            onSized={(width, height) => {
              setDataset((current) => {
                if (!current) return current;
                return {
                  ...current,
                  pages: current.pages.map((item) =>
                    item.id === page.id ? { ...item, width_px: width, height_px: height } : item,
                  ),
                };
              });
            }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="max-w-lg rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center">
              <p className="text-sm font-medium text-slate-800">
                {datasets.length === 0
                  ? "Create a dataset first"
                  : pages.length === 0
                    ? "No pages linked yet"
                    : "Select a page"}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                Use Datasets to upload folders for train/test, then come back here to draw labels.
              </p>
              <button
                type="button"
                className="btn-primary mt-4 text-xs"
                onClick={() => onManageDatasets?.(datasetId || undefined)}
              >
                Open Datasets
              </button>
            </div>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

function LinkedPageLoader({
  datasetId,
  page,
  imageUrl,
  onSized,
}: {
  datasetId: string;
  page: StudioPage;
  imageUrl: string;
  onSized: (width: number, height: number) => void;
}) {
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) onSized(img.naturalWidth, img.naturalHeight);
    };
    img.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [datasetId, imageUrl, onSized, page.id]);

  return (
    <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
      Loading linked page…
    </div>
  );
}
