"use client";

import { getInferenceApiBaseUrl, inferenceFetch } from "@/lib/api/inferenceClient";
import type { StudioDatasetCategorySpec } from "./categories";
import {
  isStudioTilePage,
  type MlDataset,
  type MlModel,
  type MlTrainingJob,
  type StudioPage,
  type StudioTask,
  type StudioModelCategory,
} from "./types";

const OFFLINE =
  "Cannot reach the inference API. Keep npm run race:tunnel running for GPU (:8008), or use local :8000 from .\\scripts\\dev.ps1 when no tunnel is up.";

async function studioFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await inferenceFetch(path, init);
  } catch {
    throw new Error(OFFLINE);
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string };
    detail?: string;
  } & T;
  if (!res.ok) {
    const message = body.error?.message ?? (typeof body.detail === "string" ? body.detail : null);
    throw new Error(message || `Studio request failed (${res.status}).`);
  }
  return body as T;
}

export function studioPageImageUrl(datasetId: string, pageId: string): string {
  return `${getInferenceApiBaseUrl()}/v1/studio/datasets/${datasetId}/pages/${pageId}.png`;
}

export function studioPageLabelsUrl(datasetId: string, pageId: string): string {
  return `${getInferenceApiBaseUrl()}/v1/studio/datasets/${datasetId}/pages/${pageId}.json`;
}

export function studioExportZipUrl(datasetId: string): string {
  return `${getInferenceApiBaseUrl()}/v1/studio/datasets/${datasetId}/export.zip`;
}

export function studioExportYoloZipUrl(datasetId: string): string {
  return `${getInferenceApiBaseUrl()}/v1/studio/datasets/${datasetId}/export-yolo.zip`;
}

export type YoloConvertResult = {
  ok: boolean;
  dataset_id: string;
  task: string;
  path: string;
  data_yaml: string;
  images: number;
  instances: number;
  train: number;
  val: number;
  empty_pages: number;
  total_json: number;
  skipped_labels: Record<string, number>;
  issues: string[];
  ready: boolean;
};

export async function convertDatasetToYolo(datasetId: string): Promise<YoloConvertResult> {
  return readJson<YoloConvertResult>(
    await studioFetch(`/v1/studio/datasets/${datasetId}/convert-yolo`, { method: "POST" }),
  );
}

export type CreateTilesResult = MlDataset & {
  tiles_created?: number;
  tiles_labeled?: number;
  tiles_skipped_small?: number;
  tiles_skipped_no_drawing?: number;
  tiles_full_page_fallback?: number;
  tiles_skipped_unlabeled?: number;
  tile_size?: number;
  tile_overlap?: number;
  tile_min_side?: number;
};

export type ExportCropsResult = MlDataset & {
  source_dataset_id?: string;
  crops_created?: number;
  pages_used?: number;
  skipped_empty?: number;
};

export type ExportCropSelection = {
  pageId: string;
  label: string;
  points: number[][];
  shapeType?: string;
};

export async function exportAnnotationCrops(
  datasetId: string,
  options: {
    classLabels?: string[];
    pageIds?: string[];
    selections?: ExportCropSelection[];
    targetName?: string;
    category?: string;
    paddingFrac?: number;
    minSidePx?: number;
    square?: boolean;
  },
): Promise<ExportCropsResult> {
  return readJson<ExportCropsResult>(
    await studioFetch(`/v1/studio/datasets/${datasetId}/export-crops`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        classLabels: options.classLabels,
        pageIds: options.pageIds,
        selections: options.selections,
        targetName: options.targetName,
        category: options.category,
        paddingFrac: options.paddingFrac ?? 0.25,
        minSidePx: options.minSidePx ?? 64,
        square: options.square ?? true,
      }),
    }),
  );
}

export async function createDatasetTiles(
  datasetId: string,
  options: {
    tileSize?: number;
    overlap?: number;
    minSide?: number | null;
    onlyLabeled?: boolean;
    replaceExisting?: boolean;
    skipUnlabeled?: boolean;
  } = {},
): Promise<CreateTilesResult> {
  return readJson<CreateTilesResult>(
    await studioFetch(`/v1/studio/datasets/${datasetId}/create-tiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tileSize: options.tileSize ?? 640,
        overlap: options.overlap ?? 0.2,
        minSide: options.minSide ?? null,
        onlyLabeled: options.onlyLabeled ?? false,
        replaceExisting: options.replaceExisting ?? true,
        skipUnlabeled: options.skipUnlabeled ?? false,
      }),
    }),
  );
}

export type StudioFsEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  kind: string;
  linkable?: boolean;
};

export type StudioFsListing = {
  path: string;
  parent: string | null;
  entries: StudioFsEntry[];
};

export async function browseLocalFs(path?: string | null): Promise<StudioFsListing> {
  const query = path ? `?path=${encodeURIComponent(path)}` : "";
  return readJson<StudioFsListing>(await studioFetch(`/v1/studio/fs${query}`));
}

export async function listDatasets(): Promise<MlDataset[]> {
  const body = await readJson<{ datasets: MlDataset[] }>(await studioFetch("/v1/studio/datasets"));
  return body.datasets ?? [];
}

export async function updateDatasetClassNames(
  datasetId: string,
  classNames: string[],
): Promise<MlDataset> {
  return readJson<MlDataset>(
    await studioFetch(`/v1/studio/datasets/${datasetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classNames }),
    }),
  );
}

export async function updateDatasetPurpose(
  datasetId: string,
  category: string,
): Promise<MlDataset> {
  return readJson<MlDataset>(
    await studioFetch(`/v1/studio/datasets/${datasetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category }),
    }),
  );
}

export async function addDatasetClass(datasetId: string, name: string): Promise<MlDataset> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Class name is required.");
  const current = await getDataset(datasetId);
  if (current.class_names.includes(trimmed)) return current;
  return updateDatasetClassNames(datasetId, [...current.class_names, trimmed]);
}

export async function getDataset(id: string): Promise<MlDataset> {
  return readJson<MlDataset>(await studioFetch(`/v1/studio/datasets/${id}`));
}

export async function createDataset(input: {
  name: string;
  task?: StudioTask;
  category?: StudioModelCategory | string;
  classNames?: string[];
}): Promise<MlDataset> {
  return readJson<MlDataset>(
    await studioFetch("/v1/studio/datasets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        task: input.task,
        category: input.category,
        classNames: input.classNames,
      }),
    }),
  );
}

export async function deleteDataset(id: string): Promise<void> {
  await readJson(await studioFetch(`/v1/studio/datasets/${id}`, { method: "DELETE" }));
}

export async function linkLocalPath(
  datasetId: string,
  path: string,
  split: "train" | "test" = "train",
): Promise<MlDataset> {
  return readJson<MlDataset>(
    await studioFetch(`/v1/studio/datasets/${datasetId}/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, split }),
    }),
  );
}

export async function unlinkLocalPath(datasetId: string, path: string): Promise<MlDataset> {
  return readJson<MlDataset>(
    await studioFetch(`/v1/studio/datasets/${datasetId}/unlink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }),
  );
}

export async function deleteDatasetPage(datasetId: string, pageId: string): Promise<MlDataset> {
  return readJson<MlDataset>(
    await studioFetch(`/v1/studio/datasets/${datasetId}/pages/${pageId}`, { method: "DELETE" }),
  );
}

export async function deleteDatasetTiles(datasetId: string): Promise<MlDataset> {
  const res = await studioFetch(`/v1/studio/datasets/${datasetId}/tiles`, { method: "DELETE" });
  if (res.status === 404) {
    const current = await getDataset(datasetId);
    const tiles = (current.pages ?? []).filter(isStudioTilePage);
    let next = current;
    for (const page of tiles) {
      next = await deleteDatasetPage(datasetId, page.id);
    }
    return { ...next, tiles_removed: tiles.length };
  }
  return readJson<MlDataset>(res);
}

export async function setDatasetPageSplit(
  datasetId: string,
  pageId: string,
  split: "train" | "test",
): Promise<StudioPage> {
  return readJson<StudioPage>(
    await studioFetch(`/v1/studio/datasets/${datasetId}/pages/${pageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ split }),
    }),
  );
}

export async function uploadDatasetFolder(
  datasetId: string,
  files: File[],
  options: {
    split?: "train" | "test";
    dpi?: number;
    convertPdf?: boolean;
  } = {},
): Promise<MlDataset> {
  const form = new FormData();
  form.append("split", options.split ?? "train");
  form.append("dpi", String(options.dpi ?? 300));
  form.append("convertPdf", options.convertPdf === false ? "false" : "true");
  for (const file of files) {
    const name = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    form.append("files", file, name);
  }
  return readJson<MlDataset>(
    await studioFetch(`/v1/studio/datasets/${datasetId}/upload`, {
      method: "POST",
      body: form,
    }),
  );
}

export async function convertDatasetPdfs(
  datasetId: string,
  options: { dpi?: number; pageIds?: string[] } = {},
): Promise<MlDataset> {
  return readJson<MlDataset>(
    await studioFetch(`/v1/studio/datasets/${datasetId}/convert-pdfs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dpi: options.dpi ?? 300,
        pageIds: options.pageIds,
      }),
    }),
  );
}

export async function saveDatasetPageLabels(
  datasetId: string,
  pageId: string,
  labels: unknown,
  options?: { keepalive?: boolean },
): Promise<StudioPage> {
  return readJson<StudioPage>(
    await studioFetch(`/v1/studio/datasets/${datasetId}/pages/${pageId}/labels`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(labels),
      keepalive: options?.keepalive === true,
    }),
  );
}

export async function fetchPageLabels(datasetId: string, pageId: string): Promise<unknown | null> {
  const res = await studioFetch(`/v1/studio/datasets/${datasetId}/pages/${pageId}.json`);
  if (res.status === 404) return null;
  return readJson(res);
}

export async function listJobs(): Promise<MlTrainingJob[]> {
  const body = await readJson<{ jobs: MlTrainingJob[] }>(await studioFetch("/v1/studio/jobs"));
  return body.jobs ?? [];
}

export function studioJobPreviewUrl(
  jobId: string,
  cacheKey?: string | number | null,
  opts?: { epoch?: number | null; kind?: "pred" | "gt" },
): string {
  const base = `${getInferenceApiBaseUrl()}/v1/studio/jobs/${jobId}/preview.png`;
  const q = new URLSearchParams();
  if (cacheKey != null && cacheKey !== "") q.set("v", String(cacheKey));
  if (opts?.epoch != null) q.set("epoch", String(opts.epoch));
  if (opts?.kind === "gt") q.set("kind", "gt");
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

export function studioJobPlotUrl(jobId: string, name: string, cacheKey?: string | number | null): string {
  const base = `${getInferenceApiBaseUrl()}/v1/studio/jobs/${jobId}/plots/${encodeURIComponent(name)}`;
  return cacheKey != null && cacheKey !== "" ? `${base}?v=${encodeURIComponent(String(cacheKey))}` : base;
}

export type StudioBaseModel = {
  id: string;
  name: string;
  task: StudioTask;
  family: string;
  category?: string;
  categories?: string[];
  description: string;
  runnable?: boolean;
  ready?: boolean;
};

export async function listBaseModels(task?: StudioTask): Promise<{
  models: StudioBaseModel[];
  default: { detect: string; segment: string };
  categories?: StudioDatasetCategorySpec[];
}> {
  const q = task ? `?task=${encodeURIComponent(task)}` : "";
  return readJson(await studioFetch(`/v1/studio/base-models${q}`));
}

export async function startTrainingJob(input: {
  datasetId: string;
  epochs: number;
  batch: number;
  imgsz: number;
  baseModel: string;
  modelName?: string;
}): Promise<MlTrainingJob> {
  const body = await readJson<{ job: MlTrainingJob }>(
    await studioFetch("/v1/studio/train", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
  return body.job;
}

export async function deleteJob(id: string): Promise<void> {
  await readJson(await studioFetch(`/v1/studio/jobs/${id}`, { method: "DELETE" }));
}

export async function listModels(): Promise<MlModel[]> {
  const body = await readJson<{ models: MlModel[] }>(await studioFetch("/v1/studio/models"));
  return body.models ?? [];
}

export async function getActiveModel(): Promise<MlModel | null> {
  const body = await readJson<{ models: MlModel[]; active: MlModel | null }>(
    await studioFetch("/v1/studio/models"),
  );
  return body.active ?? body.models.find((model) => model.is_active) ?? null;
}

export async function setActiveModel(id: string | null): Promise<void> {
  await readJson(
    await studioFetch("/v1/studio/models/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: id }),
    }),
  );
}

export async function deleteModel(id: string): Promise<void> {
  await readJson(await studioFetch(`/v1/studio/models/${id}`, { method: "DELETE" }));
}
