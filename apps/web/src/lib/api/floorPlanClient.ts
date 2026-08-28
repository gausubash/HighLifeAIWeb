/**
 * Client for the local-first floor-plan intelligence API (`services/api`).
 * Does not replace the existing viewer/calibration path until later prompts.
 */

import type { AnalysisRun, FloorPlanSceneGraph, FpProject, PlanDocument } from "@highlife/shared-types";
import { getInferenceApiBaseUrl } from "@/lib/api/inferenceClient";

/** GreenMap yolo11x-blueprint-layout-detector — title block, legend, drawing area. */
export const LAYOUT_DETECT_MODEL = "layout:greenmap";

const DEFAULT_BASE = "http://127.0.0.1:8001";

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
};

export function getFloorPlanApiBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_FLOOR_PLAN_API_URL?.replace(/\/$/, "") || DEFAULT_BASE
  );
}

async function parseJson<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T | ApiErrorBody;
  if (!res.ok) {
    const err = body as ApiErrorBody;
    const msg = err.error?.message ?? `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

export async function createFpProject(name: string): Promise<FpProject> {
  const res = await fetch(`${getFloorPlanApiBaseUrl()}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return parseJson<FpProject>(res);
}

export async function getFpProject(projectId: string): Promise<FpProject> {
  const res = await fetch(`${getFloorPlanApiBaseUrl()}/api/projects/${projectId}`);
  return parseJson<FpProject>(res);
}

export async function uploadPlanDocument(
  projectId: string,
  file: File,
): Promise<PlanDocument> {
  const form = new FormData();
  form.append("projectId", projectId);
  form.append("file", file);
  const res = await fetch(`${getFloorPlanApiBaseUrl()}/api/plans/upload`, {
    method: "POST",
    body: form,
  });
  return parseJson<PlanDocument>(res);
}

export async function getPlanDocument(planId: string): Promise<PlanDocument> {
  const res = await fetch(`${getFloorPlanApiBaseUrl()}/api/plans/${planId}`);
  return parseJson<PlanDocument>(res);
}

export async function listPlanPages(planId: string): Promise<NonNullable<PlanDocument["pages"]>> {
  const res = await fetch(`${getFloorPlanApiBaseUrl()}/api/plans/${planId}/pages`);
  return parseJson(res);
}

export function pageImageUrl(
  pageId: string,
  variant: "original" | "preview" = "original",
): string {
  return `${getFloorPlanApiBaseUrl()}/api/pages/${pageId}/image?variant=${variant}`;
}

export async function createAnalysisRun(
  planId: string,
  pageId: string,
  profile = "manual_demo",
): Promise<AnalysisRun> {
  const res = await fetch(
    `${getFloorPlanApiBaseUrl()}/api/plans/${planId}/analysis-runs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId, profile }),
    },
  );
  return parseJson<AnalysisRun>(res);
}

export async function getAnalysisRun(runId: string): Promise<AnalysisRun> {
  const res = await fetch(`${getFloorPlanApiBaseUrl()}/api/analysis-runs/${runId}`);
  return parseJson<AnalysisRun>(res);
}

export async function getSceneGraph(runId: string): Promise<FloorPlanSceneGraph> {
  const res = await fetch(
    `${getFloorPlanApiBaseUrl()}/api/analysis-runs/${runId}/scene-graph`,
  );
  return parseJson<FloorPlanSceneGraph>(res);
}

export type DetectedRegion = {
  id: string;
  type: string;
  label: string;
  confidence: number;
  polygonPx: { x: number; y: number }[];
  bboxPx: { x: number; y: number; width: number; height: number };
  attributes: Record<string, unknown>;
};

export type DetectResponse = {
  modelId: string;
  modelVersion: string;
  widthPx: number;
  heightPx: number;
  regions: DetectedRegion[];
  warning: string | null;
};

export type DetectModelOption = {
  id: string;
  name: string;
  kind: "builtin" | "studio" | "stack";
  task: string;
  description: string;
  ready: boolean;
  runnable: boolean;
  active?: boolean;
  class_names?: string[];
};

export type DetectModelsResponse = {
  models: DetectModelOption[];
  default: string;
  wall_backend: string;
};

export async function fetchDetectModels(
  signal?: AbortSignal,
): Promise<DetectModelsResponse> {
  const res = await fetch(`${getInferenceApiBaseUrl()}/v1/detect/models`, { signal });
  return parseJson<DetectModelsResponse>(res);
}

export async function detectPageRegions(opts: {
  image: Blob;
  fileName?: string;
  originalWidth: number;
  originalHeight: number;
  modelId?: string | null;
  detectModel?: string | null;
  headers?: HeadersInit;
}): Promise<DetectResponse> {
  const form = new FormData();
  form.append("file", opts.image, opts.fileName ?? "page.png");
  form.append("originalWidth", String(opts.originalWidth));
  form.append("originalHeight", String(opts.originalHeight));
  if (opts.detectModel) {
    form.append("detectModel", opts.detectModel);
  } else if (opts.modelId) {
    form.append("modelId", opts.modelId);
  }
  const res = await fetch(`${getInferenceApiBaseUrl()}/v1/detect`, {
    method: "POST",
    headers: opts.headers,
    body: form,
  });
  return parseJson<DetectResponse>(res);
}

export type DetectTileRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DetectStreamMeta = {
  tiled: boolean;
  tileCount: number;
  tileSize: number;
  width: number;
  height: number;
};

export type DetectStreamTileEvent = {
  index: number;
  total: number;
  tile: DetectTileRect;
  regionCount?: number;
  regions?: DetectedRegion[];
};

export type DetectStreamHandlers = {
  onMeta?: (meta: DetectStreamMeta) => void;
  onStatus?: (message: string) => void;
  onTileStart?: (event: DetectStreamTileEvent) => void;
  onTileDone?: (event: DetectStreamTileEvent) => void;
  onFinal?: (result: DetectResponse) => void;
  onError?: (message: string, code?: string) => void;
  onCancelled?: () => void;
};

export class DetectStreamCancelled extends Error {
  constructor() {
    super("Detection cancelled");
    this.name = "DetectStreamCancelled";
  }
}

function parseSseChunk(buffer: string): { events: Array<{ event: string; data: string }>; rest: string } {
  const events: Array<{ event: string; data: string }> = [];
  let rest = buffer;
  while (true) {
    const sep = rest.indexOf("\n\n");
    if (sep < 0) break;
    const block = rest.slice(0, sep);
    rest = rest.slice(sep + 2);
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length) events.push({ event, data: dataLines.join("\n") });
  }
  return { events, rest };
}

export type NormalizedCrop = { x: number; y: number; width: number; height: number };

/** Streaming detect with per-tile progress (SSE). */
export async function detectPageRegionsStream(
  opts: {
    image: Blob;
    fileName?: string;
    originalWidth?: number;
    originalHeight?: number;
    modelId?: string | null;
    detectModel?: string | null;
    /** Normalized drawing-area crop from layout detect / manual box. */
    drawingCrop?: NormalizedCrop | null;
    signal?: AbortSignal;
  },
  handlers: DetectStreamHandlers = {},
): Promise<DetectResponse> {
  const form = new FormData();
  form.append("file", opts.image, opts.fileName ?? "page.png");
  if (opts.originalWidth != null) form.append("originalWidth", String(opts.originalWidth));
  if (opts.originalHeight != null) form.append("originalHeight", String(opts.originalHeight));
  if (opts.detectModel) form.append("detectModel", opts.detectModel);
  else if (opts.modelId) form.append("modelId", opts.modelId);
  if (opts.drawingCrop) {
    form.append("drawingCrop", JSON.stringify(opts.drawingCrop));
  }

  const res = await fetch(`${getInferenceApiBaseUrl()}/v1/detect/stream`, {
    method: "POST",
    body: form,
    signal: opts.signal,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new Error(body?.error?.message ?? `Detect stream failed (${res.status})`);
  }
  if (!res.body) throw new Error("Detect stream returned no body.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: DetectResponse | null = null;
  let streamError: Error | null = null;

  const stop = async () => {
    try {
      await reader.cancel();
    } catch {
      // already closed
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseChunk(buffer);
      buffer = parsed.rest;
      for (const { event, data } of parsed.events) {
        if (event === "ping") continue;
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (event === "meta") {
          handlers.onMeta?.(payload as unknown as DetectStreamMeta);
        } else if (event === "status") {
          handlers.onStatus?.(String(payload.message ?? "Working…"));
        } else if (event === "tile_start") {
          handlers.onTileStart?.(payload as unknown as DetectStreamTileEvent);
        } else if (event === "tile_done") {
          handlers.onTileDone?.(payload as unknown as DetectStreamTileEvent);
        } else if (event === "final") {
          finalResult = payload as unknown as DetectResponse;
          handlers.onFinal?.(finalResult);
          // Do not wait for the server to close the socket — that can hang with keep-alive.
          await stop();
          return finalResult;
        } else if (event === "cancelled") {
          handlers.onCancelled?.();
          await stop();
          throw new DetectStreamCancelled();
        } else if (event === "error") {
          const message = String(payload.message ?? "Detection failed");
          const code = typeof payload.code === "string" ? payload.code : undefined;
          handlers.onError?.(message, code);
          streamError = new Error(message);
          await stop();
          throw streamError;
        }
      }
    }
  } finally {
    // Ensure the reader is released if we exit via done/error without stop().
  }

  if (streamError) throw streamError;
  if (!finalResult) {
    if (opts.signal?.aborted) throw new DetectStreamCancelled();
    throw new Error("Detection stream ended without a result.");
  }
  return finalResult;
}

