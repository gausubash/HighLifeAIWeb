"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";
import { fetchWithJwtSkewRetry } from "./jwtSkew";

export function createClient() {
  const { url, key, configured, cloud } = getSupabaseEnv();
  if (cloud) {
    console.warn(
      "NEXT_PUBLIC_SUPABASE_URL is a cloud project. PDFs and accounts will leave this machine. Use npm run data:start for local Docker.",
    );
  }
  if (!configured) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  return createBrowserClient(url, key, {
    global: { fetch: fetchWithJwtSkewRetry },
  });
}
