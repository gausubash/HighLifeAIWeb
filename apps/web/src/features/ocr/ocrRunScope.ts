export type OcrRunKind = "title_block" | "drawing" | "both";

export function ocrRunFromChecks(opts: {
  title: boolean;
  drawing: boolean;
  allPages: boolean;
  pageNumber: number;
}): { kind: OcrRunKind; targetPages?: number[]; applyScale: boolean } | null {
  if (!opts.title && !opts.drawing) return null;
  return {
    kind: opts.title && opts.drawing ? "both" : opts.title ? "title_block" : "drawing",
    targetPages: opts.allPages ? undefined : [opts.pageNumber],
    applyScale: Boolean(opts.title),
  };
}
