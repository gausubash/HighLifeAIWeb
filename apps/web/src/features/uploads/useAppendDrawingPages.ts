"use client";

import { useCallback, useRef, useState } from "react";
import { appendDrawingPages } from "@/lib/pdf/appendDrawingPages";

type Options = {
  analysisId: string;
  projectId: string;
  onAdded?: (args: { firstNewIndex: number; pageCount: number }) => void;
};

export function useAppendDrawingPages({ analysisId, projectId, onAdded }: Options) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const openFilePicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const appendFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList?.length) return;
      setBusy(true);
      setError(null);
      try {
        const { addedPages, result } = await appendDrawingPages({
          analysisId,
          projectId,
          files: Array.from(fileList),
        });
        const firstNewPageNumber = addedPages[0]?.pageNumber;
        const firstNewIndex =
          firstNewPageNumber != null
            ? result.pages.findIndex((p) => p.pageNumber === firstNewPageNumber)
            : result.pages.length - 1;
        onAdded?.({
          firstNewIndex: Math.max(0, firstNewIndex),
          pageCount: result.pages.length,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add pages.");
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [analysisId, projectId, onAdded],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void appendFiles(e.target.files);
    },
    [appendFiles],
  );

  return {
    busy,
    error,
    inputRef,
    openFilePicker,
    handleFileChange,
    appendFiles,
  };
}
