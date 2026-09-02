const IAT_PAD_MS = 400;
const IAT_WAIT_CAP_MS = 8_000;

export function isJwtIssuedAtFutureMessage(text: string | null | undefined): boolean {
  return /JWT issued at future|PGRST303/i.test(text ?? "");
}

export function parseJwtIatSeconds(token: string | null | undefined): number | null {
  if (!token) return null;
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(padded)) as { iat?: unknown };
    return typeof json.iat === "number" && Number.isFinite(json.iat) ? json.iat : null;
  } catch {
    return null;
  }
}

export function jwtIatWaitMs(token: string | null | undefined, nowMs = Date.now()): number {
  const iat = parseJwtIatSeconds(token);
  if (iat == null) return 0;
  return Math.min(Math.max(0, iat * 1000 - nowMs + IAT_PAD_MS), IAT_WAIT_CAP_MS);
}

function bearerToken(headers: Headers): string | null {
  const raw = headers.get("Authorization") ?? headers.get("authorization");
  if (!raw) return null;
  return raw.replace(/^Bearer\s+/i, "").trim() || null;
}

function requestHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  if (typeof Request !== "undefined" && input instanceof Request) {
    return new Headers(input.headers);
  }
  return new Headers(init?.headers);
}

async function isJwtIssuedAtFutureResponse(response: Response): Promise<boolean> {
  if (response.status !== 401 && response.status !== 403) return false;
  const text = await response.clone().text().catch(() => "");
  return isJwtIssuedAtFutureMessage(text);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Wait out a slightly-future JWT iat, then retry PGRST303 once the API clock catches up. */
export async function fetchWithJwtSkewRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const waitMs = jwtIatWaitMs(bearerToken(requestHeaders(input, init)));
  if (waitMs > 0) await sleep(waitMs);

  const maxAttempts = 4;
  let response: Response | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const nextInput = typeof Request !== "undefined" && input instanceof Request ? input.clone() : input;
    response = await fetch(nextInput, init);
    if (attempt === maxAttempts - 1 || !(await isJwtIssuedAtFutureResponse(response))) {
      return response;
    }
    await sleep(400 * (attempt + 1));
  }
  return response!;
}
