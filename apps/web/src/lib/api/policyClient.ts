import type { AnalysisResult } from "@highlife/shared-types";
import { getInferenceApiBaseUrl } from "./inferenceClient";
import { snakeToCamelDeep } from "./snakeCamel";

export type AnalyzePolicyPayload = {
  analysis_id: string;
  project_id: string;
  source_file_name?: string;
  mm_per_pixel?: number | null;
  calibration_verified?: boolean;
  width_px?: number;
  height_px?: number;
  model_id?: string;
  model_version?: string;
  entity_statuses?: Record<string, string>;
  regions: Array<{
    id: string;
    type: string;
    label: string;
    confidence: number;
    polygonPx: { x: number; y: number }[];
    bboxPx: { x: number; y: number; width: number; height: number };
    attributes?: Record<string, unknown>;
  }>;
  policy_version?: string | null;
};

export async function requestPolicyAnalyze(
  body: AnalyzePolicyPayload,
  signal?: AbortSignal,
): Promise<{ ok: boolean; result: AnalysisResult; sceneGraph?: Record<string, unknown> }> {
  const res = await fetch(`${getInferenceApiBaseUrl()}/v1/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Policy analyze failed (${res.status}): ${detail}`);
  }
  const raw = (await res.json()) as {
    ok?: boolean;
    result: Record<string, unknown>;
    scene_graph?: Record<string, unknown>;
  };
  return {
    ok: raw.ok !== false,
    result: snakeToCamelDeep<AnalysisResult>(raw.result),
    sceneGraph: raw.scene_graph
      ? snakeToCamelDeep<Record<string, unknown>>(raw.scene_graph)
      : undefined,
  };
}
