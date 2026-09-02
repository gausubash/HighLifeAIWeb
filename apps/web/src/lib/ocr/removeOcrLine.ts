import type { OcrLine, PageOcrMeta } from "@highlife/shared-types";

export type OcrLineSource = "title_block" | "drawing";

export function materializeOcrLines(meta: PageOcrMeta | null | undefined): OcrLine[] {
  if (!meta) return [];
  if (meta.lines?.length) {
    return meta.lines.map((line) => ({
      text: line.text?.trim() ?? "",
      confidence: line.confidence ?? meta.confidence ?? 0.85,
      bbox: line.bbox ?? null,
    })).filter((line) => line.text.length > 0);
  }
  if (meta.textHint?.trim()) {
    return meta.textHint
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((text) => ({
        text,
        confidence: meta.confidence ?? 0.85,
      }));
  }
  return [];
}

function withDerivedFields(meta: PageOcrMeta, lines: OcrLine[]): PageOcrMeta | null {
  if (!lines.length) return null;
  const textHint = lines.map((l) => l.text).join("\n");
  return {
    ...meta,
    lines,
    textHint,
    ocrLineCount: lines.length,
  };
}

export function removeOcrLineAt(
  meta: PageOcrMeta | null | undefined,
  index: number,
): PageOcrMeta | null {
  if (!meta) return null;
  const lines = materializeOcrLines(meta);
  if (index < 0 || index >= lines.length) return meta;
  return withDerivedFields(
    meta,
    lines.filter((_, i) => i !== index),
  );
}

export function clearOcrLines(meta: PageOcrMeta | null | undefined): PageOcrMeta | null {
  if (!meta) return null;
  return null;
}
