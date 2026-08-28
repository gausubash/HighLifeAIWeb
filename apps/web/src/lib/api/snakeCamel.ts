/** Convert snake_case analysis payloads from inference API to frontend camelCase. */

function snakeToCamelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function snakeToCamelDeep<T = unknown>(value: unknown): T {
  if (Array.isArray(value)) {
    return value.map((item) => snakeToCamelDeep(item)) as T;
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[snakeToCamelKey(k)] = snakeToCamelDeep(v);
    }
    return out as T;
  }
  return value as T;
}
