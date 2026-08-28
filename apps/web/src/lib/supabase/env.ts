export function getSupabaseEnv() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "";
  const placeholder = !url || url.includes("your-project");
  return {
    url,
    key,
    configured: Boolean(url && key && !placeholder),
  };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv().configured;
}
