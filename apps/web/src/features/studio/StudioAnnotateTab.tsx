"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { WorkspaceShell } from "@/components/shell/WorkspaceShell";
import { AnnotationPanel } from "@/features/plan-editor/AnnotationPanel";
import { EditorToolbar } from "@/features/plan-editor/EditorToolbar";
import { OverlayHotkeys } from "@/features/plan-editor/OverlayHotkeys";
import { overlaysToLabelMe, parseLabelMeJson } from "@/features/plan-editor/labelme";
import { extraClassesFromDataset, mergeAnnotateClasses } from "@/features/plan-editor/labelClasses";
import { pageKey, useOverlayStore } from "@/features/plan-editor/useOverlayStore";
import { PdfPageViewer } from "@/features/plan-viewer/PdfPageViewer";
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
  sidebar?: ReactNode;
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
  sidebar,
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
  const suppressSaveRef = useRef(false);
  const lastSavedRef = useRef<string>("");

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

  useEffect(() => {
    setPageIndex(0);
    setOverlayTool("polygon");
    resetView();
  }, [datasetId, resetView, setOverlayTool, setPageIndex]);

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
    void (async () => {
      const raw = await fetchPageLabels(datasetId, pageId);
      if (cancelled) return;
      // Mark as hydrate so autosave does not immediately PUT the same labels.
      suppressSaveRef.current = true;
      if (!raw) {
        useOverlayStore.getState().loadPageEntities([], {
          analysisId: datasetId,
          pageNumber: overlayPageNumber,
        });
        lastSavedRef.current = "[]";
        return;
      }
      const parsed = parseLabelMeJson(raw);
      useOverlayStore.getState().loadPageEntities(parsed.entities, {
        analysisId: datasetId,
        pageNumber: overlayPageNumber,
      });
      lastSavedRef.current = JSON.stringify(
        overlaysToLabelMe(parsed.entities, {
          imagePath: `${pageId}.png`,
          imageWidth: page.width_px,
          imageHeight: page.height_px,
        }).shapes,
      );
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
    const pageId = page.id;
    const widthPx = page.width_px;
    const heightPx = page.height_px;

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

      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const entities = useOverlayStore.getState().pages[key]?.entities ?? [];
        const doc = overlaysToLabelMe(entities, {
          imagePath: `${pageId}.png`,
          imageWidth: widthPx,
          imageHeight: heightPx,
        });
        const fingerprint = JSON.stringify(doc.shapes);
        if (fingerprint === lastSavedRef.current) return;
        lastSavedRef.current = fingerprint;
        void saveDatasetPageLabels(datasetId, pageId, doc).then((updated) => {
          setDataset((current) => {
            if (!current) return current;
            const pages = current.pages.map((item) =>
              item.id === updated.id
                ? {
                    ...item,
                    labeled: updated.labeled,
                    shape_count: updated.shape_count,
                    labels_path: updated.labels_path,
                  }
                : item,
            );
            return {
              ...current,
              pages,
              labeled_count: pages.filter((item) => item.labeled).length,
            };
          });
        });
      }, 700);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [datasetId, overlayPageNumber, page?.id, page?.width_px, page?.height_px]);

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
        lastSavedRef.current = JSON.stringify(doc.shapes);
        setDataset((current) =>
          current
            ? {
                ...current,
                pages: current.pages.map((item) =>
                  item.id === updated.id
                    ? {
                        ...item,
                        labeled: updated.labeled,
                        shape_count: updated.shape_count,
                        labels_path: updated.labels_path,
                      }
                    : item,
                ),
              }
            : current,
        );
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
      showSidebar
      hideTopBar
      allowNewProjectShortcut={false}
      sidebar={sidebar}
      leftPanelTitle="Pages"
      leftPanel={
        <div className="space-y-1.5">
          <button
            type="button"
            className="w-full text-left text-[10px] text-brand-700 hover:underline"
            onClick={() => onManageDatasets?.(datasetId || undefined)}
          >
            Datasets →
          </button>
          {datasetId ? (
            <button
              type="button"
              className="w-full text-left text-[10px] text-brand-700 hover:underline"
              onClick={() => onOpenTiles?.(datasetId)}
            >
              Tiles →
            </button>
          ) : null}
          {pages.length === 0 ? (
            <p className="px-0.5 text-[10px] leading-relaxed text-slate-500">
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
                      onClick={() => setPageIndex(index)}
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
                            ? "absolute inset-x-0 bottom-0 bg-brand-800/85 px-1 py-0 text-center text-[9px] font-medium text-white"
                            : "absolute inset-x-0 bottom-0 bg-black/65 px-1 py-0 text-center text-[9px] font-medium text-white"
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
      inspector={
        <div className="space-y-4">
          <p className="text-[11px] leading-relaxed text-slate-500">
            Draw on the page, or import/export LabelMe JSON. Pick pages from the left panel.
          </p>
          {page ? (
            <AnnotationPanel
              includeLayoutClasses
              extraClasses={extraClasses}
              onAddClass={datasetId ? handleAddClass : undefined}
              addClassError={addClassError}
              onImportFile={(file) => void handleImportLabelMe(file)}
              onExport={handleExportLabelMe}
              importError={importError}
            />
          ) : (
            <p className="text-[11px] text-slate-500">Select a page to edit labels.</p>
          )}
        </div>
      }
      statusText={
        dataset
          ? `${dataset.name} · ${pages.length} pages · ${dataset.labeled_count} labelled`
          : "Draw labels on linked pages"
      }
    >
      <div className="flex h-full min-h-0 flex-col bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs">
          <label className="flex items-center gap-1.5 text-slate-600">
            Dataset
            <select
              className="max-w-[14rem] rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-800"
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
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
        {loadError ? (
          <p className="border-b border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{loadError}</p>
        ) : null}
        {importError ? (
          <p className="border-b border-red-100 bg-red-50 px-3 py-1 text-[11px] text-red-700">
            {importError}
          </p>
        ) : null}
        {page && pageImageUrl && page.width_px > 0 && page.height_px > 0 ? (
          <>
            <OverlayHotkeys enabled allowDraw />
            <EditorToolbar showDrawTools classOptions={annotateClassOptions} />
            <PdfPageViewer
              key={`${page.id}-${page.width_px}x${page.height_px}`}
              imagePath={pageImageUrl}
              widthPx={page.width_px}
              heightPx={page.height_px}
              toolMode="none"
              overlayMode="annotate"
              showLoupeToggle
            />
          </>
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
