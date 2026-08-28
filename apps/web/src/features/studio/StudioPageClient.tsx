"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceShell } from "@/components/shell/WorkspaceShell";
import { DetectModelSelect } from "@/features/plan-editor/DetectModelSelect";
import {
  DetectStreamCancelled,
  detectPageRegionsStream,
  type DetectTileRect,
} from "@/lib/api/floorPlanClient";
import {
  deleteJob,
  deleteModel,
  listBaseModels,
  listDatasets,
  listJobs,
  listModels,
  setActiveModel,
  startTrainingJob,
  type StudioBaseModel,
} from "@/lib/studio/studioClient";
import {
  basesForDatasetCategory,
  categoryLabel,
  FALLBACK_DATASET_CATEGORIES,
  type StudioDatasetCategorySpec,
} from "@/lib/studio/categories";
import type { MlDataset, MlModel, MlTrainingJob } from "@/lib/studio/types";
import { classSwatch, hexToRgba } from "@/features/plan-editor/styles";
import { StudioAnnotateTab } from "./StudioAnnotateTab";
import { StudioDatasetsTab } from "./StudioDatasetsTab";
import { StudioSidebar } from "./StudioSidebar";
import type { StudioTabId } from "./StudioTabBar";
import { StudioTilesTab } from "./StudioTilesTab";
import { TrainingMonitor } from "./TrainingMonitor";
import { useStudioNavStore } from "./useStudioNavStore";

type Tab = StudioTabId;

const FALLBACK_DETECT = [
  "yolo_layout.pt",
  "yolo_walls_obb.pt",
  "yolo_room.pt",
  "yolov8n.pt",
  "yolov8s.pt",
  "yolov8m.pt",
  "yolov8l.pt",
  "yolov8x.pt",
  "yolo11n.pt",
  "yolo11s.pt",
  "yolo11m.pt",
  "yolo11l.pt",
  "yolo11x.pt",
  "retinanet_latest.pth",
  "faster_rcnn_latest.pth",
  "cascade_swin_latest.pth",
];
const FALLBACK_SEG = [
  "mitunet_walls.pth",
  "yolov8n-seg.pt",
  "yolov8s-seg.pt",
  "yolov8m-seg.pt",
  "yolov8l-seg.pt",
  "yolov8x-seg.pt",
  "yolo11n-seg.pt",
  "yolo11s-seg.pt",
  "yolo11m-seg.pt",
  "yolo11l-seg.pt",
  "yolo11x-seg.pt",
  "deeplab_walls_best.h5",
  "unet_walls_best.h5",
];

function baseModelLabel(item: string, catalog?: StudioBaseModel[]): string {
  const fromApi = catalog?.find((m) => m.id === item);
  if (fromApi) {
    const blocked = fromApi.runnable === false || fromApi.ready === false;
    return blocked ? `${fromApi.name} (needs TensorFlow / Python 3.10–3.12)` : fromApi.name;
  }
  if (item === "retinanet_latest.pth") return "RetinaNet (Cubicasa pretrained)";
  if (item === "faster_rcnn_latest.pth") return "Faster R-CNN (MMDet walls)";
  if (item === "cascade_swin_latest.pth") return "Cascade R-CNN (MMDet walls)";
  if (item === "deeplab_walls_best.h5") return "DeepLabV3+ (floorData)";
  if (item === "unet_walls_best.h5") return "UNet (floorData)";
  if (item === "yolo_layout.pt") return "GreenMap layout (YOLO11x)";
  if (item === "yolo_walls_obb.pt") return "GreenMap wall OBB (YOLO11x)";
  if (item === "yolo_room.pt") return "Architect room & fixtures (YOLO)";
  if (item === "mitunet_walls.pth") return "MitUNet walls (PyTorch)";
  if (item.endsWith("-seg.pt")) return `YOLO segment · ${item.replace(".pt", "")}`;
  if (item.endsWith(".pt")) return `YOLO detect · ${item.replace(".pt", "")}`;
  return item;
}

function defaultBaseForDataset(
  dataset: MlDataset | undefined,
  specs: StudioDatasetCategorySpec[],
): string {
  if (!dataset) return "yolov8n-seg.pt";
  const spec =
    specs.find((c) => c.id === dataset.category) ??
    FALLBACK_DATASET_CATEGORIES.find((c) => c.id === dataset.category);
  if (spec) return spec.default_base;
  return dataset.task === "segment" ? "yolov8n-seg.pt" : "yolov8n.pt";
}

function defaultFineTunedModelName(base: string, when = new Date()): string {
  const leaf = base.split(/[/\\]/).pop() || "model";
  const stem = leaf.replace(/\.(pt|pth|h5)$/i, "") || "model";
  const ymd = when.toISOString().slice(0, 10);
  const hm = when.toTimeString().slice(0, 5).replace(":", "");
  return `${stem} fine-tuned ${ymd} ${hm}`;
}

export function StudioPageClient() {
  const tab = useStudioNavStore((s) => s.tab);
  const setTab = useStudioNavStore((s) => s.setTab);
  const [error, setError] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<MlDataset[]>([]);
  const [jobs, setJobs] = useState<MlTrainingJob[]>([]);
  const [models, setModels] = useState<MlModel[]>([]);
  const [baseCatalog, setBaseCatalog] = useState<StudioBaseModel[]>([]);
  const [categorySpecs, setCategorySpecs] = useState<StudioDatasetCategorySpec[]>(
    FALLBACK_DATASET_CATEGORIES,
  );
  const [loading, setLoading] = useState(true);
  const [watchJobId, setWatchJobId] = useState<string | null>(null);

  const [datasetId, setDatasetId] = useState("");
  const [epochs, setEpochs] = useState(20);
  const [batch, setBatch] = useState(2);
  const [imgsz, setImgsz] = useState(640);
  const [baseModel, setBaseModel] = useState("yolov8n-seg.pt");
  const [modelName, setModelName] = useState(() => defaultFineTunedModelName("yolov8n-seg.pt"));
  const [modelNameTouched, setModelNameTouched] = useState(false);
  const [starting, setStarting] = useState(false);

  const [inferModelId, setInferModelId] = useState("");
  const [inferFile, setInferFile] = useState<File | null>(null);
  const [inferPreview, setInferPreview] = useState<string | null>(null);
  const [inferBusy, setInferBusy] = useState(false);
  const [inferRan, setInferRan] = useState(false);
  const [inferSize, setInferSize] = useState<{ width: number; height: number } | null>(null);
  const [inferRegions, setInferRegions] = useState<
    {
      label: string;
      confidence: number;
      bboxPx: { x: number; y: number; width: number; height: number };
      polygonPx?: { x: number; y: number }[];
    }[]
  >([]);
  const [inferZoom, setInferZoom] = useState(1);
  const [hiddenClasses, setHiddenClasses] = useState<Set<string>>(new Set());
  const [hoveredClass, setHoveredClass] = useState<string | null>(null);
  const [hoveredRegionIndex, setHoveredRegionIndex] = useState<number | null>(null);
  const [inferProgress, setInferProgress] = useState<string | null>(null);
  const [inferTile, setInferTile] = useState<DetectTileRect | null>(null);
  const inferAbortRef = useRef<AbortController | null>(null);
  const [confirmDeleteModelId, setConfirmDeleteModelId] = useState<string | null>(null);
  const [confirmDeleteJobId, setConfirmDeleteJobId] = useState<string | null>(null);

  const inferLegends = useMemo(() => {
    const counts = new Map<string, { count: number; totalConf: number }>();
    for (const r of inferRegions) {
      const key = r.label || "unknown";
      const curr = counts.get(key) ?? { count: 0, totalConf: 0 };
      curr.count += 1;
      curr.totalConf += r.confidence;
      counts.set(key, curr);
    }
    return [...counts.entries()]
      .map(([label, data]) => ({
        label,
        count: data.count,
        avgConfidence: data.totalConf / data.count,
        color: classSwatch(label),
      }))
      .sort((a, b) => b.count - a.count);
  }, [inferRegions]);

  const refresh = useCallback(async () => {
    const [nextDatasets, nextJobs, nextModels, baseRes] = await Promise.all([
      listDatasets(),
      listJobs(),
      listModels(),
      listBaseModels().catch(() => ({
        models: [] as StudioBaseModel[],
        default: { detect: "yolov8n.pt", segment: "yolov8n-seg.pt" },
        categories: FALLBACK_DATASET_CATEGORIES,
      })),
    ]);
    setDatasets(nextDatasets);
    setJobs(nextJobs);
    setModels(nextModels);
    setBaseCatalog(baseRes.models ?? []);
    if (baseRes.categories?.length) setCategorySpecs(baseRes.categories);
    setDatasetId((current) => current || nextDatasets[0]?.id || "");
    setInferModelId((current) => {
      if (current) return current;
      return nextModels.find((model) => model.is_active)?.id ?? nextModels[0]?.id ?? "";
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError(null);
      try {
        await refresh();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load Model Studio.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    const running = jobs.some((job) => job.status === "queued" || job.status === "running");
    if (!running) return;
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [jobs, refresh]);

  const selectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === datasetId),
    [datasets, datasetId],
  );

  const bases = useMemo(() => {
    const task = selectedDataset?.task ?? "segment";
    const fromApi = basesForDatasetCategory(
      baseCatalog,
      task,
      selectedDataset?.category,
    );
    if (fromApi.length) return fromApi;
    return task === "segment" ? FALLBACK_SEG : FALLBACK_DETECT;
  }, [baseCatalog, selectedDataset?.task, selectedDataset?.category]);

  const basesByCategory = useMemo(() => {
    const task = selectedDataset?.task ?? "segment";
    const dsCategory = selectedDataset?.category;
    const items = baseCatalog.filter((m) => m.task === task);
    const specs = categorySpecs.filter((s) => s.task === task);
    const relevantSpecs = dsCategory
      ? specs.filter((s) => s.id === dsCategory || s.id.startsWith("general_"))
      : specs;

    if (!items.length) {
      if (dsCategory) {
        const spec = specs.find((s) => s.id === dsCategory);
        return [{ id: dsCategory, label: spec?.label ?? categoryLabel(dsCategory), ids: bases }];
      }
      return [{ id: "all", label: "Available", ids: bases }];
    }

    const groups = relevantSpecs
      .map((spec) => ({
        id: spec.id,
        label: spec.label,
        ids: items.filter((m) => m.category === spec.id).map((m) => m.id),
      }))
      .filter((g) => g.ids.length > 0);

    if (groups.length) return groups;

    const byCat = new Map<string, string[]>();
    for (const m of items) {
      const cat = m.category ?? "other";
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(m.id);
    }
    return Array.from(byCat.entries()).map(([id, ids]) => ({
      id,
      label: categoryLabel(id),
      ids,
    }));
  }, [baseCatalog, bases, categorySpecs, selectedDataset?.category, selectedDataset?.task]);

  const modelsByCategory = useMemo(() => {
    const order = categorySpecs.map((c) => c.id);
    const groups = new Map<string, MlModel[]>();
    for (const model of models) {
      const cat = model.category ?? "uncategorized";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(model);
    }
    return Array.from(groups.entries()).sort((a, b) => {
      const ai = order.indexOf(a[0]);
      const bi = order.indexOf(b[0]);
      if (ai === -1 && bi === -1) return a[0].localeCompare(b[0]);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [models, categorySpecs]);

  useEffect(() => {
    if (!bases.length) return;
    const runnable = bases.filter((id) => {
      const meta = baseCatalog.find((m) => m.id === id);
      return meta?.runnable !== false && meta?.ready !== false;
    });
    const pool = runnable.length ? runnable : bases;
    if (!pool.includes(baseModel)) {
      const next = pool[0];
      setBaseModel(next);
      if (!modelNameTouched) setModelName(defaultFineTunedModelName(next));
    }
  }, [baseCatalog, baseModel, bases, modelNameTouched]);

  const monitoredJob = useMemo(() => {
    if (watchJobId) {
      const match = jobs.find((job) => job.id === watchJobId);
      if (match) return match;
    }
    return (
      jobs.find((job) => job.status === "running" || job.status === "queued") ??
      jobs[0] ??
      null
    );
  }, [jobs, watchJobId]);

  const onStartTrain = async () => {
    setError(null);
    if (!selectedDataset) {
      setError("Choose a dataset first.");
      return;
    }
    if (!selectedDataset.ready) {
      setError("Label at least one page in Annotate before fine-tuning.");
      return;
    }
    const name = modelName.trim() || defaultFineTunedModelName(baseModel);
    setStarting(true);
    try {
      const job = await startTrainingJob({
        datasetId: selectedDataset.id,
        baseModel,
        modelName: name,
        epochs,
        imgsz,
        batch,
      });
      setWatchJobId(job.id);
      setModelName(defaultFineTunedModelName(baseModel));
      setModelNameTouched(false);
      await refresh();
      setTab("train");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start training.");
    } finally {
      setStarting(false);
    }
  };

  const onActivate = async (id: string, active: boolean) => {
    setError(null);
    try {
      await setActiveModel(active ? id : null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the active model.");
    }
  };

  const onDeleteModel = async (id: string) => {
    setError(null);
    if (confirmDeleteModelId !== id) {
      setConfirmDeleteModelId(id);
      return;
    }
    try {
      await deleteModel(id);
      setConfirmDeleteModelId(null);
      if (inferModelId === `studio:${id}`) {
        setInferModelId("");
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the model.");
    }
  };

  const onDeleteJob = async (id: string) => {
    setError(null);
    if (confirmDeleteJobId !== id) {
      setConfirmDeleteJobId(id);
      return;
    }
    try {
      await deleteJob(id);
      setConfirmDeleteJobId(null);
      if (watchJobId === id) setWatchJobId(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the job.");
    }
  };

  const onInfer = async () => {
    setError(null);
    if (!inferModelId || !inferFile) {
      setError("Pick a model and an image.");
      return;
    }
    inferAbortRef.current?.abort();
    const ac = new AbortController();
    inferAbortRef.current = ac;
    setInferBusy(true);
    setInferRegions([]);
    setInferSize(null);
    setInferRan(false);
    setInferTile(null);
    setInferProgress("Starting…");
    try {
      const result = await detectPageRegionsStream(
        {
          image: inferFile,
          fileName: inferFile.name,
          detectModel: inferModelId,
          signal: ac.signal,
        },
        {
          onMeta: (meta) => {
            setInferSize({ width: meta.width, height: meta.height });
            setInferProgress(
              meta.tiled ? `Tiling ${meta.tileCount} windows…` : "Running detection…",
            );
          },
          onStatus: (message) => {
            setInferTile(null);
            setInferProgress(message);
          },
          onTileStart: (ev) => {
            setInferTile(ev.tile);
            setInferProgress(
              ev.total > 1 ? `Tile ${ev.index} / ${ev.total}` : "Running detection…",
            );
          },
          onTileDone: (ev) => {
            setInferTile(ev.index >= ev.total ? null : ev.tile);
            if (ev.regions?.length) {
              setInferRegions((prev) => [
                ...prev,
                ...ev.regions!.map((r) => ({
                  label: r.label,
                  confidence: r.confidence,
                  bboxPx: r.bboxPx,
                  polygonPx: r.polygonPx,
                })),
              ]);
            }
            setInferProgress(
              ev.index >= ev.total
                ? "Finishing…"
                : ev.total > 1
                  ? `Tile ${ev.index} / ${ev.total} · ${ev.regionCount ?? 0} hits`
                  : "Finishing…",
            );
          },
        },
      );
      setInferRegions(
        (result.regions ?? []).map((r) => ({
          label: r.label,
          confidence: r.confidence,
          bboxPx: r.bboxPx,
          polygonPx: r.polygonPx,
        })),
      );
      if (typeof result.widthPx === "number" && typeof result.heightPx === "number") {
        setInferSize({ width: result.widthPx, height: result.heightPx });
      }
      setInferRan(true);
      setInferTile(null);
      setInferProgress(null);
    } catch (e) {
      if (e instanceof DetectStreamCancelled || (e instanceof Error && e.name === "AbortError")) {
        setInferProgress(null);
        setInferTile(null);
        setError(null);
        return;
      }
      setError(
        e instanceof Error
          ? e.message.includes("Failed to fetch")
            ? "uvicorn is not running on :8000. Start the inference API first."
            : e.message
          : "Inference failed.",
      );
      setInferProgress(null);
      setInferTile(null);
    } finally {
      if (inferAbortRef.current === ac) inferAbortRef.current = null;
      setInferBusy(false);
    }
  };

  const onCancelInfer = () => {
    inferAbortRef.current?.abort();
  };

  const studioSidebar = <StudioSidebar active={tab} onChange={setTab} />;

  if (tab === "datasets") {
    return (
      <StudioDatasetsTab
        sidebar={studioSidebar}
        initialDatasetId={datasetId || undefined}
        onAnnotate={(id) => {
          setDatasetId(id);
          setTab("annotate");
        }}
        onOpenTiles={(id) => {
          setDatasetId(id);
          setTab("tiles");
        }}
        onOpenTrain={(id) => {
          setDatasetId(id);
          setTab("train");
          void refresh().catch((e) => setError(e instanceof Error ? e.message : "Could not refresh Studio."));
        }}
      />
    );
  }

  if (tab === "annotate") {
    return (
      <StudioAnnotateTab
        sidebar={studioSidebar}
        initialDatasetId={datasetId || undefined}
        onOpenTrain={(id) => {
          setDatasetId(id);
          setTab("train");
          void refresh().catch((e) => setError(e instanceof Error ? e.message : "Could not refresh Studio."));
        }}
        onManageDatasets={(id) => {
          if (id) setDatasetId(id);
          setTab("datasets");
        }}
        onOpenTiles={(id) => {
          setDatasetId(id);
          setTab("tiles");
        }}
      />
    );
  }

  if (tab === "tiles") {
    return (
      <StudioTilesTab
        sidebar={studioSidebar}
        initialDatasetId={datasetId || undefined}
        onAnnotate={(id) => {
          setDatasetId(id);
          setTab("annotate");
        }}
        onOpenTrain={(id) => {
          setDatasetId(id);
          setTab("train");
          void refresh().catch((e) => setError(e instanceof Error ? e.message : "Could not refresh Studio."));
        }}
      />
    );
  }

  return (
    <WorkspaceShell
      showSidebar
      hideTopBar
      allowNewProjectShortcut={false}
      sidebar={studioSidebar}
      statusText={loading ? "Loading Model Studio…" : `${datasets.length} datasets · ${models.length} models`}
    >
      <div className="flex h-full min-h-0 flex-col bg-white">
        {error && (
          <p className="mx-4 mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "train" && (
            <div className="space-y-6">
              {monitoredJob ? <TrainingMonitor job={monitoredJob} /> : null}
              <div className="grid gap-6 lg:grid-cols-2">
              <section className="card space-y-3">
                <h2 className="text-sm font-semibold">Start fine-tune</h2>
                <p className="text-xs text-slate-500">
                  Training reads labelled pages from this PC (uvicorn :8000). Bases are grouped by
                  model purpose — layout analysis, wall detection, wall segmentation, and so on.
                  Domain models (GreenMap layout/walls, Architect rooms) download on first train.
                </p>
                <label className="block text-xs font-medium text-slate-600">
                  Dataset
                  <select
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                    value={datasetId}
                    onChange={(e) => {
                      setDatasetId(e.target.value);
                      const next = datasets.find((d) => d.id === e.target.value);
                      if (next) {
                        const nextBase = defaultBaseForDataset(next, categorySpecs);
                        setBaseModel(nextBase);
                        if (!modelNameTouched) setModelName(defaultFineTunedModelName(nextBase));
                      }
                    }}
                  >
                    {datasets.map((dataset) => (
                      <option key={dataset.id} value={dataset.id}>
                        {dataset.name}
                        {dataset.category ? ` · ${categoryLabel(dataset.category)}` : ""} (
                        {dataset.labeled_count}/{dataset.image_count} labelled)
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  Base model
                  <select
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                    value={baseModel}
                    onChange={(e) => {
                      const next = e.target.value;
                      setBaseModel(next);
                      if (!modelNameTouched) setModelName(defaultFineTunedModelName(next));
                    }}
                  >
                    {basesByCategory.map((group) => (
                      <optgroup key={group.id} label={group.label}>
                        {group.ids.map((item) => {
                          const meta = baseCatalog.find((m) => m.id === item);
                          const disabled = meta?.runnable === false || meta?.ready === false;
                          return (
                            <option key={item} value={item} disabled={disabled}>
                              {baseModelLabel(item, baseCatalog)}
                            </option>
                          );
                        })}
                      </optgroup>
                    ))}
                  </select>
                  {baseCatalog.some((m) => m.family === "floordata" && m.runnable === false) ? (
                    <span className="mt-1 block text-[11px] font-normal text-amber-700">
                      floorData needs the TensorFlow venv at{" "}
                      <code className="rounded bg-amber-50 px-1">services/inference/.venv-tf</code>{" "}
                      (Python 3.10–3.12 +{" "}
                      <code className="rounded bg-amber-50 px-1">requirements-tensorflow.txt</code>
                      ). Training still runs from the main uvicorn process via that interpreter.
                    </span>
                  ) : baseCatalog.some((m) => m.family === "floordata" && m.runnable !== false) ? (
                    <span className="mt-1 block text-[11px] font-normal text-slate-500">
                      floorData trains in the dedicated TensorFlow venv (
                      <code className="rounded bg-slate-100 px-1">.venv-tf</code>
                      ).
                    </span>
                  ) : null}
                </label>
                <label className="block text-xs font-medium text-slate-600">
                  Fine-tuned model name
                  <input
                    type="text"
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                    value={modelName}
                    placeholder={defaultFineTunedModelName(baseModel)}
                    onChange={(e) => {
                      setModelName(e.target.value);
                      setModelNameTouched(true);
                    }}
                  />
                  <span className="mt-1 block text-[11px] font-normal text-slate-500">
                    Defaults to base name + today’s date and time. Edit freely before starting.
                  </span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <label className="text-xs font-medium text-slate-600">
                    Epochs
                    <input
                      type="number"
                      min={1}
                      max={300}
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                      value={epochs}
                      onChange={(e) => setEpochs(Number(e.target.value))}
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Batch
                    <input
                      type="number"
                      min={1}
                      max={16}
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                      value={batch}
                      onChange={(e) => setBatch(Number(e.target.value))}
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    Image size
                    <input
                      type="number"
                      min={320}
                      max={1280}
                      step={32}
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                      value={imgsz}
                      onChange={(e) => setImgsz(Number(e.target.value))}
                    />
                  </label>
                </div>
                <button type="button" className="btn-primary" disabled={starting} onClick={() => void onStartTrain()}>
                  {starting ? "Starting…" : "Fine-tune on this PC"}
                </button>
              </section>
              <section className="space-y-2">
                <h2 className="text-sm font-semibold">Jobs</h2>
                {jobs.length === 0 ? (
                  <p className="text-sm text-slate-500">No training jobs yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {jobs.map((job) => (
                      <li key={job.id} className="rounded border border-slate-200 p-3 text-sm">
                        <button
                          type="button"
                          className="flex w-full justify-between gap-2 text-left"
                          onClick={() => setWatchJobId(job.id)}
                        >
                          <span className="font-medium">{job.task}</span>
                          <span className="text-xs uppercase text-slate-500">{job.status}</span>
                        </button>
                        <p className="mt-1 text-[11px] text-slate-500">
                          {job.base_model} · {job.epochs} ep · batch {job.batch}
                        </p>
                        <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-100">
                          <div
                            className="h-full bg-brand-600"
                            style={{ width: `${Math.min(100, job.progress)}%` }}
                          />
                        </div>
                        {job.log_tail && <p className="mt-1 text-[11px] text-slate-600">{job.log_tail}</p>}
                        {job.error && <p className="mt-1 text-[11px] text-red-700">{job.error}</p>}
                        <div className="mt-2 flex items-center justify-between gap-2">
                          {watchJobId === job.id ? (
                            <p className="text-[10px] text-brand-700">Showing in monitor ↑</p>
                          ) : (
                            <span />
                          )}
                          <button
                            type="button"
                            className={
                              confirmDeleteJobId === job.id
                                ? "rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                                : "rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              void onDeleteJob(job.id);
                            }}
                          >
                            {confirmDeleteJobId === job.id
                              ? job.status === "running" || job.status === "queued"
                                ? "Confirm force remove"
                                : "Confirm remove"
                              : job.status === "running" || job.status === "queued"
                                ? "Force remove"
                                : "Remove"}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              </div>
            </div>
          )}

          {tab === "models" && (
            <section className="space-y-3">
              <p className="text-sm text-slate-600">
                Activate one model to use it in the project drawing Detect overlay.
              </p>
              {models.length === 0 ? (
                <p className="text-sm text-slate-500">Train a model first.</p>
              ) : (
                <div className="space-y-6">
                  {modelsByCategory.map(([cat, catModels]) => (
                    <div key={cat}>
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {categoryLabel(cat)}
                      </h3>
                      <ul className="space-y-2">
                        {catModels.map((model) => (
                          <li
                            key={model.id}
                            className="flex items-start justify-between gap-3 rounded border border-slate-200 p-3"
                          >
                            <div>
                              <p className="text-sm font-medium">{model.name}</p>
                              <p className="text-[11px] text-slate-500">
                                {model.task} · {model.architecture} · {model.class_names.join(", ")}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <button
                                type="button"
                                className={
                                  model.is_active ? "btn-primary text-xs" : "btn-secondary text-xs"
                                }
                                onClick={() => void onActivate(model.id, !model.is_active)}
                              >
                                {model.is_active ? "Active" : "Use in viewer"}
                              </button>
                              <button
                                type="button"
                                className={
                                  confirmDeleteModelId === model.id
                                    ? "rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                                    : "rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                                }
                                onClick={() => void onDeleteModel(model.id)}
                              >
                                {confirmDeleteModelId === model.id ? "Confirm delete" : "Delete"}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {tab === "infer" && (
            <section className="card max-w-4xl space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Test inference</h2>
                  <p className="text-xs text-slate-500">
                    Run detection models on custom floor plan images and inspect labeled overlays.
                  </p>
                </div>
                {inferRan && inferLegends.length > 0 && (
                  <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
                    {inferRegions.length} detection{inferRegions.length === 1 ? "" : "s"} across {inferLegends.length} class{inferLegends.length === 1 ? "" : "es"}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Detection model
                  </label>
                  <DetectModelSelect
                    value={inferModelId}
                    onChange={setInferModelId}
                    disabled={inferBusy}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Test image
                  </label>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="block w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs file:font-medium hover:file:bg-slate-200"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      setInferFile(file);
                      if (inferPreview) URL.revokeObjectURL(inferPreview);
                      setInferPreview(file ? URL.createObjectURL(file) : null);
                      setInferRegions([]);
                      setInferSize(null);
                      setInferRan(false);
                      setInferTile(null);
                      setInferProgress(null);
                      setInferZoom(1);
                      setHiddenClasses(new Set());
                      setHoveredClass(null);
                      setHoveredRegionIndex(null);
                    }}
                  />
                </div>
              </div>

              {inferPreview && (
                <div className="space-y-2">
                  {/* Zoom & Overlay Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-medium text-slate-500 mr-1">Zoom:</span>
                      <button
                        type="button"
                        onClick={() => setInferZoom((z) => Math.max(0.25, Number((z - 0.25).toFixed(2))))}
                        disabled={inferZoom <= 0.25}
                        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                        title="Zoom out"
                      >
                        −
                      </button>
                      <span className="min-w-[3.5rem] text-center font-mono font-medium text-slate-700">
                        {Math.round(inferZoom * 100)}%
                      </span>
                      <button
                        type="button"
                        onClick={() => setInferZoom((z) => Math.min(4, Number((z + 0.25).toFixed(2))))}
                        disabled={inferZoom >= 4}
                        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                        title="Zoom in"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => setInferZoom(1)}
                        className="ml-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100"
                        title="Reset zoom to 100%"
                      >
                        100%
                      </button>
                      <button
                        type="button"
                        onClick={() => setInferZoom(0.5)}
                        className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100"
                        title="Fit view (50%)"
                      >
                        50%
                      </button>
                      <button
                        type="button"
                        onClick={() => setInferZoom(1.5)}
                        className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100"
                        title="Zoom 150%"
                      >
                        150%
                      </button>
                    </div>

                    {inferLegends.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setHiddenClasses(new Set())}
                          className="rounded px-2 py-0.5 text-[11px] font-medium text-brand-700 hover:bg-brand-50"
                        >
                          Show all
                        </button>
                        <button
                          type="button"
                          onClick={() => setHiddenClasses(new Set(inferLegends.map((l) => l.label)))}
                          className="rounded px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200"
                        >
                          Hide all
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Class Legends Bar */}
                  {inferLegends.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-200 bg-white p-2 text-xs">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mr-1">
                        Legends:
                      </span>
                      {inferLegends.map((item) => {
                        const isHidden = hiddenClasses.has(item.label);
                        const isHovered = hoveredClass === item.label;
                        return (
                          <button
                            key={item.label}
                            type="button"
                            onClick={() => {
                              setHiddenClasses((prev) => {
                                const next = new Set(prev);
                                if (next.has(item.label)) {
                                  next.delete(item.label);
                                } else {
                                  next.add(item.label);
                                }
                                return next;
                              });
                            }}
                            onMouseEnter={() => setHoveredClass(item.label)}
                            onMouseLeave={() => setHoveredClass(null)}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-all",
                              isHidden
                                ? "border-slate-200 bg-slate-100 text-slate-400 line-through opacity-60"
                                : isHovered
                                  ? "border-slate-400 bg-slate-100 text-slate-900 shadow-sm ring-2 ring-brand-400/50"
                                  : "border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-slate-100",
                            )}
                            title={`Click to ${isHidden ? "show" : "hide"} ${item.label} (${item.count} items, avg conf ${(item.avgConfidence * 100).toFixed(0)}%)`}
                          >
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: item.color }}
                            />
                            <span>{item.label}</span>
                            <span
                              className={cn(
                                "rounded px-1 text-[10px] font-semibold",
                                isHidden ? "bg-slate-200 text-slate-500" : "bg-white text-slate-600",
                              )}
                            >
                              {item.count}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Scrollable & Zoomable Image Viewport */}
                  <div className="relative max-h-[32rem] min-h-[16rem] w-full overflow-auto rounded-lg border border-slate-200 bg-slate-900/5 p-2">
                    <div
                      className="relative inline-block transition-transform duration-75"
                      style={{
                        transform: `scale(${inferZoom})`,
                        transformOrigin: "top left",
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={inferPreview}
                        alt="Inference preview"
                        className="block max-h-none max-w-none rounded shadow-sm"
                        style={{ display: "block" }}
                      />
                      {inferSize ? (
                        <svg
                          className="pointer-events-auto absolute inset-0 h-full w-full"
                          viewBox={`0 0 ${inferSize.width} ${inferSize.height}`}
                          preserveAspectRatio="none"
                        >
                          {inferTile ? (
                            <rect
                              x={inferTile.x}
                              y={inferTile.y}
                              width={inferTile.width}
                              height={inferTile.height}
                              fill="rgba(14, 165, 233, 0.22)"
                              stroke="#0284c7"
                              strokeWidth={2 / inferZoom}
                            />
                          ) : null}
                          {inferRegions.map((region, index) => {
                            if (hiddenClasses.has(region.label)) return null;
                            const isClassHovered = hoveredClass === region.label;
                            const isDimmed = hoveredClass != null && !isClassHovered;
                            const isRegionHovered = hoveredRegionIndex === index;
                            const color = classSwatch(region.label);
                            const fill = hexToRgba(
                              color,
                              isRegionHovered
                                ? 0.65
                                : isClassHovered
                                  ? 0.52
                                  : isDimmed
                                    ? 0.08
                                    : 0.32,
                            );
                            const stroke = color;
                            const strokeWidth =
                              (isRegionHovered || isClassHovered ? 2.5 : 1.5) /
                              Math.max(0.5, inferZoom);
                            const poly = region.polygonPx;
                            const points =
                              poly && poly.length >= 3
                                ? poly.map((p) => `${p.x},${p.y}`).join(" ")
                                : null;

                            return (
                              <g
                                key={`${region.label}-${index}`}
                                onMouseEnter={() => setHoveredRegionIndex(index)}
                                onMouseLeave={() => setHoveredRegionIndex(null)}
                                className="cursor-pointer"
                              >
                                {points ? (
                                  <polygon
                                    points={points}
                                    fill={fill}
                                    stroke={stroke}
                                    strokeWidth={strokeWidth}
                                    strokeLinejoin="round"
                                  />
                                ) : (
                                  <rect
                                    x={region.bboxPx.x}
                                    y={region.bboxPx.y}
                                    width={region.bboxPx.width}
                                    height={region.bboxPx.height}
                                    fill={fill}
                                    stroke={stroke}
                                    strokeWidth={strokeWidth}
                                  />
                                )}
                                <title>{`${region.label} · ${(region.confidence * 100).toFixed(0)}%`}</title>
                              </g>
                            );
                          })}
                        </svg>
                      ) : null}
                    </div>
                  </div>

                  {/* Hovered region details banner */}
                  {hoveredRegionIndex != null && inferRegions[hoveredRegionIndex] && (
                    <div className="flex items-center gap-2 rounded bg-slate-800 px-3 py-1.5 text-xs text-white">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{
                          backgroundColor: classSwatch(
                            inferRegions[hoveredRegionIndex].label,
                          ),
                        }}
                      />
                      <span className="font-semibold">
                        {inferRegions[hoveredRegionIndex].label}
                      </span>
                      <span className="text-slate-300">
                        Confidence: {(inferRegions[hoveredRegionIndex].confidence * 100).toFixed(1)}%
                      </span>
                      <span className="text-slate-400 text-[11px] font-mono">
                        Box: {Math.round(inferRegions[hoveredRegionIndex].bboxPx.width)}×{Math.round(inferRegions[hoveredRegionIndex].bboxPx.height)} px
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={inferBusy || !inferFile}
                  onClick={() => void onInfer()}
                >
                  {inferBusy ? inferProgress ?? "Running…" : "Run inference"}
                </button>
                {inferBusy ? (
                  <button type="button" className="btn-secondary" onClick={onCancelInfer}>
                    Cancel
                  </button>
                ) : null}
              </div>

              {inferBusy && inferProgress ? (
                <p className="text-xs text-sky-800">{inferProgress}</p>
              ) : null}

              {inferRan ? (
                <div className="space-y-2 border-t border-slate-200 pt-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Results · {inferRegions.length} detection{inferRegions.length === 1 ? "" : "s"}
                  </h3>
                  {inferRegions.length === 0 ? (
                    <p className="text-sm text-slate-500">No detections found on this image.</p>
                  ) : (
                    <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto rounded border border-slate-200 bg-white text-xs">
                      {inferRegions.map((region, index) => {
                        const isHidden = hiddenClasses.has(region.label);
                        const isHovered = hoveredRegionIndex === index;
                        const color = classSwatch(region.label);
                        return (
                          <li
                            key={`${region.label}-${index}`}
                            onMouseEnter={() => setHoveredRegionIndex(index)}
                            onMouseLeave={() => setHoveredRegionIndex(null)}
                            className={cn(
                              "flex items-center justify-between px-3 py-1.5 transition-colors",
                              isHidden ? "bg-slate-50 text-slate-400 opacity-50" : "text-slate-700",
                              isHovered ? "bg-brand-50 text-brand-900" : "hover:bg-slate-50",
                            )}
                          >
                            <span className="inline-flex items-center gap-2">
                              <span
                                className="h-2 w-2 rounded-full shrink-0"
                                style={{ backgroundColor: color }}
                              />
                              <span className="font-medium">{region.label}</span>
                            </span>
                            <span className="font-mono text-slate-500">
                              {(region.confidence * 100).toFixed(1)}%
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ) : null}
            </section>
          )}
        </div>
      </div>
    </WorkspaceShell>
  );
}
