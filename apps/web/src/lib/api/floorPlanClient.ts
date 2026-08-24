/**
 * Client for the local-first floor-plan intelligence API (`services/api`).
 * Does not replace the existing viewer/calibration path until later prompts.
 */

import type { AnalysisRun, FloorPlanSceneGraph, FpProject, PlanDocument } from "@highlife/shared-types";
import { getInferenceApiBaseUrl } from "@/lib/api/inferenceClient";

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

export async function detectPageRegions(opts: {
  image: Blob;
  fileName?: string;
  originalWidth: number;
  originalHeight: number;
}): Promise<DetectResponse> {
  const form = new FormData();
  form.append("file", opts.image, opts.fileName ?? "page.png");
  form.append("originalWidth", String(opts.originalWidth));
  form.append("originalHeight", String(opts.originalHeight));
  const res = await fetch(`${getInferenceApiBaseUrl()}/v1/detect`, {
    method: "POST",
    body: form,
  });
  return parseJson<DetectResponse>(res);
}
