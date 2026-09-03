import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_INFERENCE_URL,
  RACE_TUNNEL_INFERENCE_URL,
  clearInferenceApiCache,
  inferenceFetch,
  resolveInferenceBackend,
} from "./inferenceClient";

describe("resolveInferenceBackend", () => {
  afterEach(() => {
    clearInferenceApiCache();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("prefers RACE tunnel when both are healthy", async () => {
    vi.stubEnv("NEXT_PUBLIC_INFERENCE_API_URL", "auto");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith(RACE_TUNNEL_INFERENCE_URL)) {
          return new Response(
            JSON.stringify({ status: "ok", run_mode: "real", device: "cuda", cuda_available: true, service: "inference" }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ status: "ok", run_mode: "real", device: "cpu", service: "inference" }), {
          status: 200,
        });
      }),
    );

    const backend = await resolveInferenceBackend();
    expect(backend.url).toBe(RACE_TUNNEL_INFERENCE_URL);
    expect(backend.kind).toBe("race");
    expect(backend.cudaAvailable).toBe(true);
  });

  it("falls back to local when tunnel is down", async () => {
    vi.stubEnv("NEXT_PUBLIC_INFERENCE_API_URL", "auto");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith(RACE_TUNNEL_INFERENCE_URL)) {
          throw new Error("connection refused");
        }
        return new Response(JSON.stringify({ status: "ok", run_mode: "mock", device: "cpu", service: "inference" }), {
          status: 200,
        });
      }),
    );

    const backend = await resolveInferenceBackend();
    expect(backend.url).toBe(LOCAL_INFERENCE_URL);
    expect(backend.kind).toBe("local");
  });

  it("defaults to local :8000 when neither probe succeeds", async () => {
    vi.stubEnv("NEXT_PUBLIC_INFERENCE_API_URL", "auto");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );

    const backend = await resolveInferenceBackend();
    expect(backend.url).toBe(LOCAL_INFERENCE_URL);
    expect(backend.kind).toBe("local");
  });
});

describe("inferenceFetch", () => {
  afterEach(() => {
    clearInferenceApiCache();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("retries the other port when the first backend is unreachable", async () => {
    vi.stubEnv("NEXT_PUBLIC_INFERENCE_API_URL", "auto");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const href = String(url);
        if (href.endsWith("/live") || href.endsWith("/health")) {
          if (href.startsWith(RACE_TUNNEL_INFERENCE_URL)) {
            return new Response(
              JSON.stringify({
                status: "ok",
                run_mode: "real",
                device: "cuda",
                cuda_available: true,
                service: "inference",
              }),
              { status: 200 },
            );
          }
          throw new Error("local down");
        }
        if (href.startsWith(RACE_TUNNEL_INFERENCE_URL)) {
          throw new Error("tunnel dropped");
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }),
    );

    const res = await inferenceFetch("/v1/studio/datasets/x/create-tiles", { method: "POST" });
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ ok: true });
  });
});
