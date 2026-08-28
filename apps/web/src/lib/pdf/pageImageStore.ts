"use client";

/**
 * PDF page images are too large for Postgres JSON. Cache PNG blobs in IndexedDB
 * and fall back to private Supabase Storage (`sb:plans/...`) when the cache misses.
 */

const DB_NAME = "highlife-page-images";
const DB_VERSION = 1;
const STORE = "pages";

function pageKey(analysisId: string, pageNumber: number): string {
  return `${analysisId}:${pageNumber}`;
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available"));
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(",", 2);
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? "image/png";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function pageImageRef(analysisId: string, pageNumber: number): string {
  return `idb:${pageKey(analysisId, pageNumber)}`;
}

export async function putPageImageBlob(
  analysisId: string,
  pageNumber: number,
  blob: Blob,
): Promise<string> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    tx.objectStore(STORE).put(blob, pageKey(analysisId, pageNumber));
  });
  db.close();
  return pageImageRef(analysisId, pageNumber);
}

export async function putPageImage(
  analysisId: string,
  pageNumber: number,
  dataUrl: string,
): Promise<string> {
  return putPageImageBlob(analysisId, pageNumber, dataUrlToBlob(dataUrl));
}

export async function getPageImageBlob(
  analysisId: string,
  pageNumber: number,
): Promise<Blob | null> {
  const db = await openDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(pageKey(analysisId, pageNumber));
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
  });
  db.close();
  return blob ?? null;
}

export async function getPageImageObjectUrl(
  analysisId: string,
  pageNumber: number,
): Promise<string | null> {
  const blob = await getPageImageBlob(analysisId, pageNumber);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

/** Resolve `idb:…`, `sb:plans/…`, or pass through data:/http(s) URLs. */
export async function resolvePageImagePath(
  imagePath: string,
  analysisId: string,
  pageNumber: number,
): Promise<string> {
  if (
    imagePath.startsWith("data:") ||
    imagePath.startsWith("blob:") ||
    imagePath.startsWith("http")
  ) {
    return imagePath;
  }

  const cached = await getPageImageObjectUrl(analysisId, pageNumber);
  if (cached) return cached;

  if (imagePath.startsWith("sb:")) {
    const { parsePlanImageRef, signedPlanUrl } = await import("@/lib/supabase/plans");
    const parsed = parsePlanImageRef(imagePath);
    if (!parsed) {
      throw new Error(`Invalid storage image path for ${analysisId} page ${pageNumber}.`);
    }
    const signed = await signedPlanUrl(parsed.path);
    const res = await fetch(signed);
    if (!res.ok) {
      throw new Error(`Could not download page ${pageNumber} from storage (${res.status}).`);
    }
    const blob = await res.blob();
    await putPageImageBlob(analysisId, pageNumber, blob);
    const url = await getPageImageObjectUrl(analysisId, pageNumber);
    if (!url) throw new Error(`Page image missing for ${analysisId} page ${pageNumber}.`);
    return url;
  }

  if (imagePath.startsWith("idb:")) {
    throw new Error(
      `Page image missing for ${analysisId} page ${pageNumber}. Re-upload the PDF.`,
    );
  }
  return imagePath;
}

export async function deletePageImageBlob(
  analysisId: string,
  pageNumber: number,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
    tx.objectStore(STORE).delete(pageKey(analysisId, pageNumber));
  });
  db.close();
}

export async function deleteAnalysisPageImages(analysisId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  const prefix = `${analysisId}:`;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      if (String(cursor.key).startsWith(prefix)) cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"));
  });
  db.close();
}
