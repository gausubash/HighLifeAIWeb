/**
 * Inference API client with automatic backend selection:
 * - RACE GPU via SSH tunnel (:8008) when the tunnel is up
 * - Local CPU uvicorn (:8000) otherwise
 *
 * Set NEXT_PUBLIC_INFERENCE_API_URL=auto (or omit) for auto mode.
 * Set an explicit URL to pin a backend.
 */

export const RACE_TUNNEL_INFERENCE_URL = "http://127.0.0.1:8008";
export const LOCAL_INFERENCE_URL = "http://127.0.0.1:8000";

export type InferenceBackendKind = "race" | "local" | "custom";

export type InferenceBackend = {
  url: string;
  kind: InferenceBackendKind;
  device?: string;
  cudaAvailable?: boolean;
  runMode?: string;
};

export type InferenceHealth = {
  status: string;
  run_mode: string;
  device: string;
  cuda_available?: boolean;
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
  storage_path?: string;
};

let _cache: InferenceBackend | null = null;
let _pending: Promise<InferenceBackend> | null = null;

const LIVE_TIMEOUT_MS = 2500;
const PROBE_TIMEOUT_MS = 4000;

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

function parseEnvUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_INFERENCE_API_URL?.trim().replace(/\/$/, "");
  if (!raw || raw.toLowerCase() === "auto") return null;
  return raw;
}

function backendKindForUrl(url: string): InferenceBackendKind {
  if (url.includes(":8008")) return "race";
  if (url.includes(":8000")) return "local";
  return "custom";
}

function backendFromHealth(url: string, health: InferenceHealth | null): InferenceBackend {
  return {
    url,
    kind: backendKindForUrl(url),
    device: health?.device,
    cudaAvailable: health?.cuda_available,
    runMode: health?.run_mode,
  };
}

/** Last resolved backend, or null before the first probe. */
export function getInferenceBackend(): InferenceBackend | null {
  return _cache;
}

/** Sync URL — uses cache, explicit env, or local default. */
export function getInferenceApiBaseUrl(): string {
  if (_cache) return _cache.url;
  return parseEnvUrl() || LOCAL_INFERENCE_URL;
}

export function clearInferenceApiCache(): void {
  _cache = null;
  _pending = null;
}

async function probeHealth(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<InferenceHealth | null> {
  try {
    const res = await fetch(`${url}/health`, {
      cache: "no-store",
      signal: timeoutSignal(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as InferenceHealth;
  } catch {
    return null;
  }
}

/** Fast "is anything listening" — /live, or /health if this is an older server. */
async function probeBackend(url: string): Promise<InferenceHealth | null> {
  try {
    const live = await fetch(`${url}/live`, {
      cache: "no-store",
      signal: timeoutSignal(LIVE_TIMEOUT_MS),
    });
    if (live.ok || live.status === 404) {
      return (
        (await probeHealth(url)) ?? {
          status: "ok",
          run_mode: "",
          device: "",
          service: "inference",
        }
      );
    }
  } catch {
    /* tunnel / local may still answer /health */
  }
  return probeHealth(url);
}

function otherKnownUrl(url: string): string | null {
  if (url === RACE_TUNNEL_INFERENCE_URL) return LOCAL_INFERENCE_URL;
  if (url === LOCAL_INFERENCE_URL) return RACE_TUNNEL_INFERENCE_URL;
  return null;
}

/** Pick RACE tunnel (:8008) when healthy, else local (:8000). */
export async function resolveInferenceBackend(force = false): Promise<InferenceBackend> {
  if (_cache && !force) return _cache;
  if (_pending && !force) return _pending;

  _pending = (async () => {
    const env = parseEnvUrl();
    if (env) {
      const health = await probeBackend(env);
      if (health) {
        _cache = backendFromHealth(env, health);
        return _cache;
      }
      _cache = { url: env, kind: backendKindForUrl(env) };
      return _cache;
    }

    const [raceHealth, localHealth] = await Promise.all([
      probeBackend(RACE_TUNNEL_INFERENCE_URL),
      probeBackend(LOCAL_INFERENCE_URL),
    ]);
    if (raceHealth) {
      _cache = backendFromHealth(RACE_TUNNEL_INFERENCE_URL, raceHealth);
      return _cache;
    }
    if (localHealth) {
      _cache = backendFromHealth(LOCAL_INFERENCE_URL, localHealth);
      return _cache;
    }

    // Prefer local :8000 when probes fail — that is what dev.ps1 starts.
    // inferenceFetch still retries :8008 if :8000 is down.
    return { url: LOCAL_INFERENCE_URL, kind: "local" };
  })();

  try {
    return await _pending;
  } finally {
    _pending = null;
  }
}

export async function resolveInferenceApiBaseUrl(force = false): Promise<string> {
  return (await resolveInferenceBackend(force)).url;
}

export function prefetchInferenceBackend(): Promise<InferenceBackend> {
  return resolveInferenceBackend();
}

export function inferenceBackendLabel(backend: InferenceBackend | null): string {
  if (!backend) return "Detecting inference…";
  if (backend.kind === "race") {
    return backend.cudaAvailable || backend.device === "cuda"
      ? "RACE GPU (tunnel :8008)"
      : "RACE (tunnel :8008, CPU)";
  }
  if (backend.kind === "local") {
    return backend.device === "cuda" ? "Local GPU (:8000)" : "Local CPU (:8000)";
  }
  return backend.url;
}

export async function inferenceFetch(path: string, init?: RequestInit): Promise<Response> {
  const fetchAt = (base: string) => fetch(`${base}${path}`, init);

  const primary = await resolveInferenceApiBaseUrl(false);
  const fallback = otherKnownUrl(primary);

  try {
    const res = await fetchAt(primary);
    if (!res.ok && (res.status === 502 || res.status === 503 || res.status === 504) && fallback) {
      clearInferenceApiCache();
      const retry = await fetchAt(fallback);
      if (retry.ok || (retry.status !== 502 && retry.status !== 503 && retry.status !== 504)) {
        _cache = { url: fallback, kind: backendKindForUrl(fallback) };
      }
      return retry;
    }
    return res;
  } catch (firstErr) {
    clearInferenceApiCache();
    if (fallback) {
      try {
        const retry = await fetchAt(fallback);
        _cache = { url: fallback, kind: backendKindForUrl(fallback) };
        return retry;
      } catch {
        /* both known backends failed */
      }
    }
    try {
      return await fetchAt(await resolveInferenceApiBaseUrl(true));
    } catch {
      clearInferenceApiCache();
      throw firstErr;
    }
  }
}

export async function fetchInferenceHealth(signal?: AbortSignal): Promise<InferenceHealth> {
  const base = await resolveInferenceApiBaseUrl();
  const res = await fetch(`${base}/health`, { signal, cache: "no-store" });
  if (!res.ok) {
    clearInferenceApiCache();
    throw new Error(`Inference health failed: ${res.status}`);
  }
  const health = (await res.json()) as InferenceHealth;
  _cache = backendFromHealth(base, health);
  return health;
}

export async function requestAnalyze(
  body: AnalyzePayload,
  signal?: AbortSignal,
): Promise<{ ok: boolean; result: Record<string, unknown> }> {
  const res = await inferenceFetch("/v1/analyze", {
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
