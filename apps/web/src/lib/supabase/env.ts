export function getSupabaseEnv() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "";
  const placeholder =
    !url ||
    !key ||
    url.includes("your-project") ||
    key.includes("your-local-anon") ||
    key.includes("your-anon-key");
  const cloud = /https?:\/\/[^/]*\.supabase\.co/i.test(url);
  return {
    url,
    key,
    configured: Boolean(url && key && !placeholder),
    cloud,
  };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv().configured;
}

export function isCloudSupabase(): boolean {
  return getSupabaseEnv().cloud;
}
