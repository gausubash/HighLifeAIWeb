"use client";

import { derivePlanStoragePath, signedPlanUrl } from "@/lib/supabase/plans";

/**
 * Original uploaded PDF bytes (not the rendered page PNG).
 * Digital PDF text extract reads this so selectable text stays in PDF space.
 */

const DB_NAME = "highlife-source-pdf";
const DB_VERSION = 1;
const STORE = "pdfs";

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

export async function putSourcePdf(analysisId: string, blob: Blob): Promise<void> {
  if (!analysisId) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
    tx.objectStore(STORE).put(blob, analysisId);
  });
  db.close();
}

export async function getSourcePdf(analysisId: string): Promise<Blob | null> {
  if (!analysisId) return null;
  const db = await openDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(analysisId);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB read failed"));
  });
  db.close();
  return blob ?? null;
}

export async function loadOriginalPdfBytes(args: {
  analysisId?: string;
  storagePath: string;
  sourceFileName: string;
  pageImagePath?: string;
  signal?: AbortSignal;
}): Promise<ArrayBuffer> {
  const { analysisId, storagePath, sourceFileName, pageImagePath, signal } = args;
  if (analysisId) {
    const cached = await getSourcePdf(analysisId);
    if (cached && cached.size > 0) {
      return cached.arrayBuffer();
    }
  }
  const folder = storagePath || derivePlanStoragePath(pageImagePath) || "";
  const ext = sourceFileName.toLowerCase().endsWith(".pdf")
    ? ".pdf"
    : folder
      ? ".pdf"
      : "";
  if (!folder || !ext) {
    throw new Error("Original PDF is not available. Re-upload the drawing as a PDF.");
  }
  const url = await signedPlanUrl(`${folder}/source${ext}`);
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Could not download the original PDF (${res.status}).`);
  }
  const blob = await res.blob();
  if (analysisId) {
    try {
      await putSourcePdf(analysisId, blob);
    } catch {
      /* cache is optional */
    }
  }
  return blob.arrayBuffer();
}
