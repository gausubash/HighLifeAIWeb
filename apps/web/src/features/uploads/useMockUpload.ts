"use client";

import { useCallback, useRef, useState } from "react";
import { z } from "zod";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export const uploadSchema = z.object({
  file: z
    .instanceof(File)
    .refine((f) => f.type === "application/pdf", "Only PDF files are accepted")
    .refine((f) => f.size <= MAX_FILE_SIZE_BYTES, "File must be under 50 MB"),
});

export type UploadValidationResult =
  | { ok: true; file: File }
  | { ok: false; error: string };

export function validatePdfUpload(file: File): UploadValidationResult {
  const result = uploadSchema.safeParse({ file });
  if (!result.success) {
    return { ok: false, error: result.error.errors[0]?.message ?? "Invalid file" };
  }
  return { ok: true, file: result.data.file };
}

interface UseMockUploadOptions {
  projectId: string;
  onComplete: (analysisId: string) => void;
}

export function useMockUpload({ projectId, onComplete }: UseMockUploadOptions) {
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(
    async (file: File) => {
      setError(null);
      const validation = validatePdfUpload(file);
      if (!validation.ok) {
        setError(validation.error);
        return;
      }

      setUploading(true);
      setProgress(0);

      // Simulate upload progress — Phase 3 uploads to Supabase Storage
      for (let p = 10; p <= 100; p += 15) {
        await new Promise((r) => setTimeout(r, 120));
        setProgress(p);
      }

      const { mockStore } = await import("@/lib/mock/store");
      const analysis = mockStore.createAnalysis(projectId, file.name);
      setUploading(false);
      onComplete(analysis.id);
    },
    [projectId, onComplete]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) void upload(file);
    },
    [upload]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void upload(file);
    },
    [upload]
  );

  return {
    error,
    progress,
    uploading,
    inputRef,
    handleDrop,
    handleFileChange,
    openFilePicker: () => inputRef.current?.click(),
  };
}
