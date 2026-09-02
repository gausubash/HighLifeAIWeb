"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { WorkspaceShell } from "@/components/shell/WorkspaceShell";
import { HeadingHint } from "@/components/ui/HoverHint";
import {
  categoryLabel,
  FALLBACK_DATASET_CATEGORIES,
  normalizeStudioCategory,
  type StudioDatasetCategorySpec,
} from "@/lib/studio/categories";
import { mergeAnnotateClasses } from "@/features/plan-editor/labelClasses";
import { CropExportPanel } from "@/features/studio/CropExportPanel";
import {
  convertDatasetPdfs,
  convertDatasetToYolo,
  createDataset,
  deleteDataset,
  deleteDatasetPage,
  exportAnnotationCrops,
  getDataset,
  listBaseModels,
  listDatasets,
  setDatasetPageSplit,
  updateDatasetPurpose,
  studioExportYoloZipUrl,
  unlinkLocalPath,
  uploadDatasetFolder,
  type YoloConvertResult,
} from "@/lib/studio/studioClient";
import type { MlDataset, StudioPage } from "@/lib/studio/types";

interface StudioDatasetsTabProps {
  activityRail?: ReactNode;
  initialDatasetId?: string;
  onAnnotate?: (datasetId: string) => void;
  onOpenTrain?: (datasetId: string) => void;
  onOpenTiles?: (datasetId: string) => void;
}

const MEDIA_RE = /\.(png|jpe?g|webp|bmp|pdf|json)$/i;
const DPI_OPTIONS = [150, 200, 300, 400, 600, 1200] as const;

function folderNameFromFiles(files: File[]): string {
  const rel = (files[0] as File & { webkitRelativePath?: string })?.webkitRelativePath || "";
  const top = rel.split(/[/\\]/).filter(Boolean)[0];
  if (top) return top;
  const stem = files[0]?.name.replace(/\.[^.]+$/, "");
  return stem || "Uploaded folder";
}

export function StudioDatasetsTab({
  activityRail,
  initialDatasetId,
  onAnnotate,
  onOpenTrain,
  onOpenTiles,
}: StudioDatasetsTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const uploadIntoIdRef = useRef<string>("");
  const [datasets, setDatasets] = useState<MlDataset[]>([]);
  const [datasetId, setDatasetId] = useState(initialDatasetId || "");
  const [dataset, setDataset] = useState<MlDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadSplit, setUploadSplit] = useState<"train" | "test">("train");
  const [dpi, setDpi] = useState(300);
  const [convertPdf, setConvertPdf] = useState(true);
  const [yoloResult, setYoloResult] = useState<YoloConvertResult | null>(null);
  const [datasetCategory, setDatasetCategory] = useState<string>("wall_segmentation");
  const [categorySpecs, setCategorySpecs] = useState<StudioDatasetCategorySpec[]>(
    FALLBACK_DATASET_CATEGORIES,
  );
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newDatasetName, setNewDatasetName] = useState("");
  const [newDatasetCategory, setNewDatasetCategory] = useState<string>("north_arrow");

  const selectedCategorySpec = useMemo(
    () =>
      categorySpecs.find((c) => c.id === datasetCategory) ??
      FALLBACK_DATASET_CATEGORIES.find((c) => c.id === datasetCategory),
    [categorySpecs, datasetCategory],
  );

  const pages = dataset?.pages ?? [];
  const pdfPageCount = useMemo(
    () => pages.filter((page) => page.kind === "pdf").length,
    [pages],
  );
  const sources = useMemo(() => {
    const groups: {
      name: string;
      path: string;
      pages: StudioPage[];
      train: number;
      test: number;
    }[] = [];
    const seen = new Map<string, number>();
    pages.forEach((item) => {
      const key = item.source_path || item.source_name || "Untitled";
      let groupIndex = seen.get(key);
      if (groupIndex === undefined) {
        groupIndex = groups.length;
        seen.set(key, groupIndex);
        groups.push({
          name: item.source_name || key,
          path: key,
          pages: [],
          train: 0,
          test: 0,
        });
      }
      groups[groupIndex].pages.push(item);
      if ((item.split || "train") === "test") groups[groupIndex].test += 1;
      else groups[groupIndex].train += 1;
    });
    return groups;
  }, [pages]);

  const refresh = useCallback(
    async (selectId?: string) => {
      const next = await listDatasets();
      setDatasets(next);
      const id = selectId ?? datasetId ?? next[0]?.id ?? "";
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
    void listBaseModels()
      .then((res) => {
        if (!cancelled && res.categories?.length) setCategorySpecs(res.categories);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setError(null);
        await refresh(initialDatasetId || undefined);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load datasets.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!datasetId) return;
    const active = datasets.find((d) => d.id === datasetId);
    if (active?.category) setDatasetCategory(active.category);
  }, [datasetId, datasets]);

  useEffect(() => {
    uploadIntoIdRef.current = datasetId;
    if (!datasetId) {
      setDataset(null);
      setYoloResult(null);
      return;
    }
    setYoloResult(null);
    let cancelled = false;
    void getDataset(datasetId)
      .then((next) => {
        if (!cancelled) setDataset(next);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not open dataset.");
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  const onCreateDataset = async () => {
    const spec =
      categorySpecs.find((c) => c.id === newDatasetCategory) ??
      FALLBACK_DATASET_CATEGORIES.find((c) => c.id === newDatasetCategory) ??
      FALLBACK_DATASET_CATEGORIES[0];
    const name = newDatasetName.trim() || `${spec.label} dataset`;
    setBusy(true);
    setError(null);
    try {
      const created = await createDataset({
        name,
        task: spec.task,
        category: spec.id,
        classNames: [...spec.class_names],
      });
      setShowCreateForm(false);
      setNewDatasetName("");
      setDatasetCategory(spec.id);
      setMessage(`Created “${created.name}”. Upload files below to add pages.`);
      await refresh(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create dataset.");
    } finally {
      setBusy(false);
    }
  };

  const openCreateForm = () => {
    setShowCreateForm(true);
    setNewDatasetCategory(datasetCategory || "north_arrow");
    if (!newDatasetName.trim()) {
      const spec =
        categorySpecs.find((c) => c.id === (datasetCategory || "north_arrow")) ??
        FALLBACK_DATASET_CATEGORIES.find((c) => c.id === "north_arrow");
      setNewDatasetName(spec ? `${spec.label} dataset` : "New dataset");
    }
  };

  const onChangePurpose = async (id: string, category: string) => {
    if (!category) return;
    setBusy(true);
    setError(null);
    try {
      const next = await updateDatasetPurpose(id, category);
      setMessage(`“${next.name}” is now ${categoryLabel(next.category)} (${next.task}).`);
      if (id === datasetId) {
        setDatasetCategory(category);
        setDataset(next);
      }
      await refresh(datasetId || id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change dataset purpose.");
    } finally {
      setBusy(false);
    }
  };

  const onDeleteDataset = async (id: string, label: string) => {
    if (
      !window.confirm(
        `Delete dataset “${label}”? This removes the studio copy — originals you uploaded are deleted from studio storage.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteDataset(id);
      setMessage(`Deleted “${label}”.`);
      await refresh("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete dataset.");
    } finally {
      setBusy(false);
    }
  };

  const onUploadFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).filter((file) => MEDIA_RE.test(file.name));
    if (files.length === 0) {
      setError("Pick PDFs, images, or LabelMe JSON.");
      return;
    }
    const hasPdf = files.some((file) => /\.pdf$/i.test(file.name));
    setBusy(true);
    setError(null);
    setMessage(
      hasPdf && convertPdf
        ? `Converting PDF(s) to images at ${dpi} DPI…`
        : `Uploading ${files.length} file(s) as ${uploadSplit}…`,
    );
    try {
      let id = uploadIntoIdRef.current || datasetId;
      if (!id) {
        const spec =
          selectedCategorySpec ??
          FALLBACK_DATASET_CATEGORIES.find((c) => c.id === "wall_segmentation") ??
          FALLBACK_DATASET_CATEGORIES[0];
        const created = await createDataset({
          name: folderNameFromFiles(files),
          task: spec.task,
          category: spec.id,
          classNames: [...spec.class_names],
        });
        id = created.id;
        setDatasetId(id);
        uploadIntoIdRef.current = id;
      } else {
        setDatasetId(id);
        uploadIntoIdRef.current = id;
      }
      const next = await uploadDatasetFolder(id, files, {
        split: uploadSplit,
        dpi,
        convertPdf,
      });
      setDataset(next);
      await refresh(next.id);
      const added = next.added_count ?? 0;
      if (hasPdf && convertPdf) {
        setMessage(
          `Converted PDF pages to images at ${dpi} DPI · ${added} page${added === 1 ? "" : "s"} added as ${uploadSplit}.`,
        );
      } else if (hasPdf && !convertPdf) {
        setMessage(
          `Stored ${added} PDF page${added === 1 ? "" : "s"} (not rasterized). Use Convert to images when ready.`,
        );
      } else {
        setMessage(
          added > 0
            ? `Uploaded ${added} image page${added === 1 ? "" : "s"} as ${uploadSplit}.`
            : "Upload finished — no new pages.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not upload.");
      setMessage(null);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  };

  const addPagesTo = (id: string, kind: "files" | "folder" = "files") => {
    setDatasetId(id);
    uploadIntoIdRef.current = id;
    if (kind === "folder") folderInputRef.current?.click();
    else fileInputRef.current?.click();
  };

  const onConvertPdfs = async () => {
    if (!datasetId) return;
    setBusy(true);
    setError(null);
    setMessage(`Converting PDF pages to images at ${dpi} DPI…`);
    try {
      const next = await convertDatasetPdfs(datasetId, { dpi });
      setDataset(next);
      await refresh(datasetId);
      setMessage(
        `Converted ${next.converted_count ?? 0} PDF page(s) to images at ${dpi} DPI.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not convert PDFs.");
      setMessage(null);
    } finally {
      setBusy(false);
    }
  };

  const onConvertYolo = async () => {
    if (!datasetId) return;
    setBusy(true);
    setError(null);
    setYoloResult(null);
    setMessage("Converting LabelMe → YOLO…");
    try {
      const result = await convertDatasetToYolo(datasetId);
      setYoloResult(result);
      const skipNote =
        result.issues.length > 0 ? ` Issues: ${result.issues.join(" ")}` : "";
      setMessage(
        `YOLO ready: ${result.images} image(s), ${result.instances} instance(s) · ${result.train} train / ${result.val} val.${skipNote}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not convert to YOLO.");
      setMessage(null);
    } finally {
      setBusy(false);
    }
  };

  const onExportCrops = async (opts: {
    classLabels: string[];
    targetName: string;
    paddingFrac: number;
    square: boolean;
  }) => {
    if (!datasetId) return;
    setBusy(true);
    setError(null);
    setMessage(`Cropping ${opts.classLabels.join(", ")} into a new dataset…`);
    try {
      const created = await exportAnnotationCrops(datasetId, {
        classLabels: opts.classLabels,
        targetName: opts.targetName || undefined,
        paddingFrac: opts.paddingFrac,
        square: opts.square,
      });
      await refresh(created.id);
      setMessage(
        `Created “${created.name}” with ${created.crops_created ?? created.image_count} crop${
          (created.crops_created ?? created.image_count) === 1 ? "" : "s"
        }. Open Annotate to review, then Train.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not crop annotations.");
      setMessage(null);
    } finally {
      setBusy(false);
    }
  };

  const onUnlink = async (path: string, label: string) => {
    if (!datasetId) return;
    if (!window.confirm(`Remove “${label}” from this dataset?`)) return;
    setBusy(true);
    setError(null);
    try {
      const next = await unlinkLocalPath(datasetId, path);
      setDataset(next);
      setMessage(`Removed ${next.removed_count ?? 0} page(s).`);
      await refresh(datasetId);
    } catch (e) {
      // Uploaded pages may not match unlink_source path rules — fall back to deleting each page.
      try {
        let current = dataset;
        const toRemove = (current?.pages ?? []).filter(
          (page) => (page.source_path || page.source_name) === path,
        );
        for (const page of toRemove) {
          current = await deleteDatasetPage(datasetId, page.id);
        }
        if (current) setDataset(current);
        setMessage(`Removed ${toRemove.length} page(s).`);
        await refresh(datasetId);
      } catch (inner) {
        setError(inner instanceof Error ? inner.message : e instanceof Error ? e.message : "Remove failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const onDeletePage = async (page: StudioPage) => {
    if (!datasetId) return;
    if (
      !window.confirm(`Remove page ${page.page_number} of “${page.source_name}” from this dataset?`)
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await deleteDatasetPage(datasetId, page.id);
      setDataset(next);
      setMessage("Page removed.");
      await refresh(datasetId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove page.");
    } finally {
      setBusy(false);
    }
  };

  const onSetSplit = async (page: StudioPage, split: "train" | "test") => {
    if (!datasetId || (page.split || "train") === split) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await setDatasetPageSplit(datasetId, page.id, split);
      setDataset((current) =>
        current
          ? {
              ...current,
              pages: current.pages.map((item) =>
                item.id === updated.id ? { ...item, ...updated } : item,
              ),
            }
          : current,
      );
      await refresh(datasetId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update train/test.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <WorkspaceShell
      hideTopBar
      allowNewProjectShortcut={false}
      activityRail={activityRail}
    >
      <div className="flex h-full min-h-0 flex-col bg-white">
        {error ? (
          <p className="border-b border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
        ) : null}
        {message ? (
          <p className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[13px] text-slate-600">
            {message}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <section className="card space-y-3">
            <HeadingHint
              title="Upload"
              as="h2"
              className="text-sm font-semibold text-slate-800"
              hint="Select a dataset first, then add images or PDFs. PDFs rasterize to pages when Convert PDFs is on. Upload without a selection creates a new dataset."
            />
            <label className="flex max-w-md flex-col gap-1 text-xs font-medium text-slate-600">
              Dataset purpose
              <select
                className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal text-slate-800"
                value={datasetCategory}
                disabled={busy}
                onChange={(e) => {
                  const next = e.target.value;
                  setDatasetCategory(next);
                  if (datasetId) void onChangePurpose(datasetId, next);
                }}
              >
                {categorySpecs.map((spec) => (
                  <option key={spec.id} value={spec.id}>
                    {spec.label} ({spec.task})
                  </option>
                ))}
              </select>
              {selectedCategorySpec ? (
                <span className="font-normal text-[13px] text-slate-500">
                  {datasetId ? "Updates the selected dataset. " : "Used when creating a dataset. "}
                  Default base: {selectedCategorySpec.default_base} · classes:{" "}
                  {selectedCategorySpec.class_names.slice(0, 4).join(", ")}
                  {selectedCategorySpec.class_names.length > 4 ? "…" : ""}
                </span>
              ) : null}
            </label>
            <div className="flex flex-wrap gap-3 text-xs">
              <label className="inline-flex items-center gap-1.5 text-slate-600">
                <input
                  type="radio"
                  name="upload-split"
                  checked={uploadSplit === "train"}
                  onChange={() => setUploadSplit("train")}
                />
                Train
              </label>
              <label className="inline-flex items-center gap-1.5 text-slate-600">
                <input
                  type="radio"
                  name="upload-split"
                  checked={uploadSplit === "test"}
                  onChange={() => setUploadSplit("test")}
                />
                Test
              </label>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={convertPdf}
                onChange={(e) => setConvertPdf(e.target.checked)}
              />
              Convert PDFs to images on upload
            </label>
            <label className="flex max-w-xs flex-col gap-1 text-xs font-medium text-slate-600">
              PDF render DPI
              <select
                className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal text-slate-800"
                value={dpi}
                onChange={(e) => setDpi(Number(e.target.value))}
              >
                {DPI_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value} DPI{value === 300 ? " (recommended)" : ""}
                  </option>
                ))}
              </select>
              <span className="font-normal text-[13px] text-slate-500">
                Higher DPI = sharper labels, larger files. Used when converting PDFs.
              </span>
            </label>
            {datasetId ? (
              <p className="text-[13px] text-slate-500">
                Next upload appends pages to{" "}
                <span className="font-medium text-slate-700">
                  {dataset?.name ?? "the selected dataset"}
                </span>
                . PDFs become images when “Convert PDFs” is on. Use Add dataset only for a
                separate collection.
              </p>
            ) : (
              <p className="text-[13px] text-slate-500">
                No dataset selected — upload will create a new one. Select a dataset below to
                add pages to it instead.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp,.json,application/pdf,image/*"
                onChange={(e) => void onUploadFiles(e.target.files)}
              />
              <input
                ref={folderInputRef}
                type="file"
                className="hidden"
                multiple
                onChange={(e) => void onUploadFiles(e.target.files)}
                {...({
                  webkitdirectory: "",
                  directory: "",
                } as InputHTMLAttributes<HTMLInputElement>)}
              />
              <button
                type="button"
                className="btn-primary"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
              >
                {busy
                  ? "Working…"
                  : datasetId
                    ? "Add files to this dataset"
                    : "Upload as new dataset"}
              </button>
              <button
                type="button"
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                disabled={busy}
                onClick={() => folderInputRef.current?.click()}
              >
                {datasetId ? "Add folder to this dataset" : "Choose folder"}
              </button>
              {datasetId ? (
                <button
                  type="button"
                  className="text-xs text-slate-600 hover:underline"
                  disabled={busy}
                  onClick={openCreateForm}
                >
                  Add another dataset
                </button>
              ) : null}
            </div>
          </section>

          <section className="mt-6 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Your datasets</h2>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded border border-brand-300 bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800 hover:bg-brand-100 disabled:opacity-40"
                  disabled={busy}
                  onClick={openCreateForm}
                >
                  Add dataset
                </button>
                <label className="flex items-center gap-1.5 text-xs text-slate-600">
                  Active
                  <select
                    className="max-w-[12rem] rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                    value={datasetId}
                    onChange={(e) => {
                      setDatasetId(e.target.value);
                      uploadIntoIdRef.current = e.target.value;
                    }}
                  >
                    <option value="">None (new on upload)</option>
                    {datasets.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            {showCreateForm ? (
              <div className="rounded border border-dashed border-brand-400 bg-white p-3">
                <p className="text-xs font-medium text-slate-800">New dataset</p>
                <p className="mt-0.5 text-[13px] text-slate-500">
                  Creates an empty dataset. Then upload pages into it, or annotate later.
                </p>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="min-w-[12rem] flex-1 text-[13px] font-medium text-slate-600">
                    Name
                    <input
                      type="text"
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal text-slate-800"
                      value={newDatasetName}
                      placeholder="North arrow crops"
                      disabled={busy}
                      onChange={(e) => setNewDatasetName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void onCreateDataset();
                        if (e.key === "Escape") setShowCreateForm(false);
                      }}
                    />
                  </label>
                  <label className="min-w-[12rem] flex-1 text-[13px] font-medium text-slate-600">
                    Purpose
                    <select
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm font-normal text-slate-800"
                      value={newDatasetCategory}
                      disabled={busy}
                      onChange={(e) => setNewDatasetCategory(e.target.value)}
                    >
                      {categorySpecs.map((spec) => (
                        <option key={spec.id} value={spec.id}>
                          {spec.label} ({spec.task})
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    disabled={busy}
                    onClick={() => void onCreateDataset()}
                  >
                    {busy ? "Creating…" : "Create"}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    disabled={busy}
                    onClick={() => setShowCreateForm(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            {datasets.length === 0 && !showCreateForm ? (
              <p className="text-sm text-slate-500">
                No datasets yet — use Add dataset, or upload a folder to start.
              </p>
            ) : datasets.length === 0 ? null : (
              <ul className="space-y-2">
                {datasets.map((item) => (
                  <li
                    key={item.id}
                    className={
                      item.id === datasetId
                        ? "rounded border border-brand-300 bg-brand-50/40 p-3"
                        : "rounded border border-slate-200 p-3"
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          className="min-w-0 text-left"
                          onClick={() => {
                            setDatasetId(item.id);
                            uploadIntoIdRef.current = item.id;
                          }}
                        >
                          <p className="text-sm font-medium text-slate-900">{item.name}</p>
                        </button>
                        <label className="mt-1 flex max-w-xs items-center gap-1.5 text-[13px] font-medium text-slate-600">
                          Purpose
                          <select
                            className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-[13px] font-normal text-slate-800"
                            value={String(normalizeStudioCategory(item.category) ?? item.category ?? "")}
                            disabled={busy}
                            onChange={(e) => void onChangePurpose(item.id, e.target.value)}
                          >
                            {!item.category ? <option value="">Choose purpose…</option> : null}
                            {categorySpecs.map((spec) => (
                              <option key={spec.id} value={spec.id}>
                                {spec.label} ({spec.task})
                              </option>
                            ))}
                          </select>
                        </label>
                        <p className="mt-1 text-[13px] text-slate-500">
                          {item.train_count ?? 0} train · {item.test_count ?? 0} test ·{" "}
                          {item.labeled_count} labelled
                          {item.ready ? " · ready" : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <button
                          type="button"
                          className="text-xs font-medium text-brand-800 hover:underline disabled:opacity-40"
                          disabled={busy}
                          onClick={() => addPagesTo(item.id)}
                        >
                          Add pages
                        </button>
                        <button
                          type="button"
                          className="text-xs text-brand-700 hover:underline"
                          onClick={() => onAnnotate?.(item.id)}
                        >
                          Annotate
                        </button>
                        <button
                          type="button"
                          className="text-xs text-brand-700 hover:underline"
                          onClick={() => onOpenTiles?.(item.id)}
                        >
                          Tiles
                        </button>
                        {item.ready ? (
                          <button
                            type="button"
                            className="text-xs text-brand-700 hover:underline"
                            onClick={() => onOpenTrain?.(item.id)}
                          >
                            Train
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="text-xs text-red-700 hover:underline disabled:opacity-40"
                          disabled={busy}
                          onClick={() => void onDeleteDataset(item.id, item.name)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
                {!showCreateForm ? (
                  <li>
                    <button
                      type="button"
                      className="w-full rounded border border-dashed border-slate-300 bg-white px-3 py-3 text-left text-sm font-medium text-brand-800 hover:border-brand-400 hover:bg-brand-50/40 disabled:opacity-40"
                      disabled={busy}
                      onClick={openCreateForm}
                    >
                      + Add dataset
                    </button>
                  </li>
                ) : null}
              </ul>
            )}
          </section>

          {dataset ? (
            <section className="mt-6 space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">Files — {dataset.name}</h2>
                  <p className="text-xs text-slate-500">
                    Add more images or PDFs to this dataset — they are not a new collection.
                    Remove pages or set train/test before fine-tuning.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                    disabled={busy}
                    onClick={() => addPagesTo(dataset.id)}
                  >
                    Add pages
                  </button>
                  {pdfPageCount > 0 ? (
                    <button
                      type="button"
                      className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                      disabled={busy}
                      onClick={() => void onConvertPdfs()}
                    >
                      Convert {pdfPageCount} PDF page{pdfPageCount === 1 ? "" : "s"} @ {dpi} DPI
                    </button>
                  ) : null}
                  {(dataset.labeled_count ?? 0) > 0 ? (
                    <button
                      type="button"
                      className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                      disabled={busy}
                      onClick={() => void onConvertYolo()}
                      title="Convert LabelMe JSON to YOLO images/labels/data.yaml"
                    >
                      Convert to YOLO
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    onClick={() => onAnnotate?.(dataset.id)}
                  >
                    Open in Annotate
                  </button>
                </div>
              </div>

              {(dataset.labeled_count ?? 0) > 0 ? (
                <CropExportPanel
                  classNames={mergeAnnotateClasses(dataset.class_names)}
                  defaultName={`${dataset.name} — crops`}
                  busy={busy}
                  onExportClass={(opts) => void onExportCrops(opts)}
                />
              ) : null}

              {yoloResult && yoloResult.dataset_id === dataset.id ? (
                <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                  <p className="font-medium text-slate-900">
                    YOLO export · {yoloResult.images} images · {yoloResult.instances} instances ·{" "}
                    {yoloResult.train} train / {yoloResult.val} val
                  </p>
                  <p className="mt-1 break-all text-[13px] text-slate-500">{yoloResult.path}</p>
                  {yoloResult.issues.length > 0 ? (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-amber-800">
                      {yoloResult.issues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[13px] text-slate-500">
                      No LabelMe issues detected. Safe to fine-tune.
                    </p>
                  )}
                  <a
                    href={studioExportYoloZipUrl(dataset.id)}
                    className="mt-2 inline-block text-brand-700 hover:underline"
                  >
                    Download YOLO ZIP
                  </a>
                </div>
              ) : null}

              {sources.length === 0 ? (
                <p className="rounded border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  No files yet. Use Add pages on this dataset.
                </p>
              ) : (
                <ul className="space-y-3">
                  {sources.map((source) => (
                    <li key={source.path} className="rounded border border-slate-200">
                      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">{source.name}</p>
                          <p className="truncate text-[13px] text-slate-400" title={source.path}>
                            {source.path}
                          </p>
                          <p className="text-[13px] text-slate-500">
                            {source.pages.length} page{source.pages.length === 1 ? "" : "s"} ·{" "}
                            {source.train} train · {source.test} test
                          </p>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 text-xs text-red-700 hover:underline disabled:opacity-40"
                          disabled={busy}
                          onClick={() => void onUnlink(source.path, source.name)}
                        >
                          Remove
                        </button>
                      </div>
                      <ul className="divide-y divide-slate-100">
                        {source.pages.map((page) => (
                          <li
                            key={page.id}
                            className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-xs"
                          >
                            <span className="text-slate-700">
                              p{page.page_number}
                              {page.kind === "pdf" ? " · PDF" : ""}
                              {page.dpi ? ` · ${page.dpi}dpi` : ""}
                              {page.labeled ? " · labelled" : ""}
                              {page.shape_count ? ` · ${page.shape_count} shapes` : ""}
                            </span>
                            <div className="flex flex-wrap items-center gap-2">
                              <select
                                className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[13px]"
                                value={page.split || "train"}
                                disabled={busy}
                                onChange={(e) =>
                                  void onSetSplit(page, e.target.value as "train" | "test")
                                }
                              >
                                <option value="train">train</option>
                                <option value="test">test</option>
                              </select>
                              <button
                                type="button"
                                className="text-red-700 hover:underline disabled:opacity-40"
                                disabled={busy}
                                onClick={() => void onDeletePage(page)}
                              >
                                Remove
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </WorkspaceShell>
  );
}
