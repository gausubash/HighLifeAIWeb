"use client";

import { createClient } from "./client";

export const PLANS_BUCKET = "plans";

export function planImageRef(objectPath: string): string {
  return `sb:${PLANS_BUCKET}/${objectPath}`;
}

export function parsePlanImageRef(
  imagePath: string,
): { bucket: string; path: string } | null {
  if (!imagePath.startsWith("sb:")) return null;
  const rest = imagePath.slice(3);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  return { bucket: rest.slice(0, slash), path: rest.slice(slash + 1) };
}

/** Derive `owner/project/analysis` folder from a stored page image ref. */
export function derivePlanStoragePath(imagePath: string | undefined): string | null {
  if (!imagePath) return null;
  const parsed = parsePlanImageRef(imagePath);
  if (!parsed) return null;
  const slash = parsed.path.lastIndexOf("/");
  if (slash <= 0) return null;
  return parsed.path.slice(0, slash);
}

export async function uploadPlanObject(
  objectPath: string,
  body: Blob | File,
  contentType: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.storage.from(PLANS_BUCKET).upload(objectPath, body, {
    upsert: true,
    contentType,
  });
  if (error) throw new Error(error.message);
}

export async function signedPlanUrl(objectPath: string): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(PLANS_BUCKET)
    .createSignedUrl(objectPath, 60 * 60);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Could not create a signed URL for the plan file.");
  }
  return data.signedUrl;
}

export async function removePlanObject(objectPath: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.storage.from(PLANS_BUCKET).remove([objectPath]);
  if (error) throw new Error(error.message);
}

export async function removePlanPrefix(prefix: string): Promise<void> {
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(PLANS_BUCKET).list(prefix, {
    limit: 1000,
  });
  if (error || !data?.length) return;

  const files: string[] = [];
  for (const item of data) {
    const child = `${prefix}/${item.name}`;
    if (!item.id) {
      await removePlanPrefix(child);
    } else {
      files.push(child);
    }
  }
  if (files.length) {
    const { error: removeError } = await supabase.storage.from(PLANS_BUCKET).remove(files);
    if (removeError) throw new Error(removeError.message);
  }
}
