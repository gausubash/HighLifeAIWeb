/**
 * Thin client for the HighLife Inference API (local FastAPI mock / contract tests).
 *
 * Frontend PC: no GPU — HTTP to localhost when testing the API contract.
 * Production path: browser → Supabase (jobs + results); RACE GPU worker pulls
 * jobs outbound. Do not point this at a public RACE URL — RACE is a private
 * virtual station, not a public API host.
 *
 * Until the job queue is wired, the UI may still use localStorage mocks.
 */

const DEFAULT_BASE = "http://127.0.0.1:8000";

export function getInferenceApiBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_INFERENCE_API_URL?.replace(/\/$/, "") || DEFAULT_BASE
  );
}

export type InferenceHealth = {
  status: string;
  run_mode: string;
  device: string;
  service: string;
    yolo_ready?: boolean;
    yolo_weights?: string | null;
    room_ready?: boolean;
    yolo_room_weights?: string | null;
    wall_ready?: boolean;
    yolo_wall_weights?: string | null;
};

export type AnalyzePayload = {
  analysis_id: string;
  project_id: string;
  source_file_name?: string;
  /** AWS / Supabase object path or signed URL — used once storage is wired. */
  storage_path?: string;
};

export async function fetchInferenceHealth(
  signal?: AbortSignal,
): Promise<InferenceHealth> {
  const res = await fetch(`${getInferenceApiBaseUrl()}/health`, { signal });
  if (!res.ok) {
    throw new Error(`Inference health failed: ${res.status}`);
  }
  return res.json() as Promise<InferenceHealth>;
}

export async function requestAnalyze(
  body: AnalyzePayload,
  signal?: AbortSignal,
): Promise<{ ok: boolean; result: Record<string, unknown> }> {
  const res = await fetch(`${getInferenceApiBaseUrl()}/v1/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Analyze failed (${res.status}): ${detail}`);
  }
  return res.json() as Promise<{ ok: boolean; result: Record<string, unknown> }>;
}
