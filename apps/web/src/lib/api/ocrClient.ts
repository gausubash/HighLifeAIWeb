import { PDF_RENDER_DPI } from "@/lib/pdf/renderPdfFirstPage";
import { getInferenceApiBaseUrl } from "./inferenceClient";
import { snakeToCamelDeep } from "./snakeCamel";

export type OcrLine = {
  text: string;
  confidence: number;
  bbox?: [number, number][] | null;
};

export type SheetOcrMeta = {
  sheetType?: string;
  title?: string | null;
  scaleText?: string | null;
  paperSize?: string | null;
  north?: string | null;
  levelName?: string | null;
  unitIds?: string[];
  warnings?: string[];
  provider?: string;
  confidence?: number;
  ocrLineCount?: number;
  textHint?: string;
  lines?: OcrLine[];
  tiling?: {
    tiled?: boolean;
    tileCount?: number;
    tileSize?: number;
    overlap?: number;
  };
};

export type PageOcrResponse = {
  ok: boolean;
  widthPx: number;
  heightPx: number;
  sourceFileName: string;
  sheet: SheetOcrMeta;
};

export type PdfOcrPageResult = {
  pageNumber: number;
  widthPx: number;
  heightPx: number;
  /** When OCR ran on a crop, width of that crop raster in pixels. */
  cropWidthPx?: number;
  cropHeightPx?: number;
  sheet: SheetOcrMeta;
};

export type PdfOcrResponse = {
  ok: boolean;
  dpi: number;
  sourceFileName: string;
  pages: PdfOcrPageResult[];
};

/** Target raster DPI when OCR re-rasterizes the source PDF (matches viewer upload DPI). */
export const PDF_OCR_DPI = PDF_RENDER_DPI;

export const OCR_DPI_MIN = 72;
export const OCR_DPI_MAX = 2400;

export function clampOcrDpi(dpi: number): number {
  if (!Number.isFinite(dpi)) return PDF_OCR_DPI;
  return Math.min(OCR_DPI_MAX, Math.max(OCR_DPI_MIN, Math.round(dpi)));
}

export function scaleSheetOcrMeta(
  sheet: SheetOcrMeta,
  fromWidthPx: number,
  fromHeightPx: number,
  toWidthPx: number,
  toHeightPx: number,
): SheetOcrMeta {
  if (fromWidthPx <= 0 || fromHeightPx <= 0 || toWidthPx <= 0 || toHeightPx <= 0) {
    return sheet;
  }
  const sx = toWidthPx / fromWidthPx;
  const sy = toHeightPx / fromHeightPx;
  if (Math.abs(sx - 1) < 1e-6 && Math.abs(sy - 1) < 1e-6) {
    return sheet;
  }
  return {
    ...sheet,
    lines: (sheet.lines ?? []).map((line) => ({
      ...line,
      bbox: line.bbox?.map(([x, y]) => [x * sx, y * sy] as [number, number]) ?? line.bbox,
    })),
  };
}

export type NormalizedCrop = { x: number; y: number; width: number; height: number };

export type PaddleOcrBackend = "classic" | "vl";

export type PaddleOcrPipelineVersion = "v1" | "v1.5" | "v1.6";

export type PaddleOcrOptions = {
  useDocOrientationClassify?: boolean;
  useDocUnwarping?: boolean;
  useTextlineOrientation?: boolean;
  textRecScoreThresh?: number;
  detLimitSideLen?: number;
  detDbThresh?: number;
  lang?: string;
  useGpu?: boolean;
  backend?: PaddleOcrBackend;
  pipelineVersion?: PaddleOcrPipelineVersion;
  useLayoutDetection?: boolean;
  vlMaxSide?: number;
};

export const DEFAULT_PADDLE_OCR_OPTIONS: PaddleOcrOptions = {
  useDocOrientationClassify: true,
  useDocUnwarping: false,
  useTextlineOrientation: true,
  textRecScoreThresh: 0.5,
  detLimitSideLen: 960,
  detDbThresh: 0.25,
  lang: "en",
  useGpu: false,
  backend: "classic",
  pipelineVersion: "v1",
  useLayoutDetection: false,
  vlMaxSide: 2048,
};

function appendOcrOptionsToForm(form: FormData, options?: PaddleOcrOptions) {
  if (!options) return;
  if (options.useDocOrientationClassify !== undefined) {
    form.append("use_doc_orientation_classify", String(options.useDocOrientationClassify));
  }
  if (options.useDocUnwarping !== undefined) {
    form.append("use_doc_unwarping", String(options.useDocUnwarping));
  }
  if (options.useTextlineOrientation !== undefined) {
    form.append("use_textline_orientation", String(options.useTextlineOrientation));
  }
  if (options.textRecScoreThresh !== undefined) {
    form.append("text_rec_score_thresh", String(options.textRecScoreThresh));
  }
  if (options.detLimitSideLen !== undefined) {
    form.append("det_limit_side_len", String(options.detLimitSideLen));
  }
  if (options.detDbThresh !== undefined) {
    form.append("det_db_thresh", String(options.detDbThresh));
  }
  if (options.lang) {
    form.append("lang", options.lang);
  }
  if (options.useGpu !== undefined) {
    form.append("use_gpu", String(options.useGpu));
  }
  if (options.backend) {
    form.append("backend", options.backend);
  }
  if (options.pipelineVersion) {
    form.append("pipeline_version", options.pipelineVersion);
  }
  if (options.useLayoutDetection !== undefined) {
    form.append("use_layout_detection", String(options.useLayoutDetection));
  }
  if (options.vlMaxSide !== undefined) {
    form.append("vl_max_side", String(options.vlMaxSide));
  }
}

/** Rasterize a PDF at ``dpi`` (default 300) and OCR each requested page. */
export async function ocrPdfDocument(
  blob: Blob,
  filename = "plan.pdf",
  options: {
    dpi?: number;
    pageNumbers?: number[];
    pageCrops?: Record<number, NormalizedCrop>;
    ocrOptions?: PaddleOcrOptions;
    signal?: AbortSignal;
  } = {},
): Promise<PdfOcrResponse> {
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("dpi", String(options.dpi ?? PDF_OCR_DPI));
  if (options.pageNumbers?.length) {
    form.append("page_numbers", options.pageNumbers.join(","));
  }
  if (options.pageCrops && Object.keys(options.pageCrops).length > 0) {
    const payload: Record<string, NormalizedCrop> = {};
    for (const [page, crop] of Object.entries(options.pageCrops)) {
      payload[String(page)] = crop;
    }
    form.append("page_crops", JSON.stringify(payload));
  }
  appendOcrOptionsToForm(form, options.ocrOptions);
  const res = await fetch(`${getInferenceApiBaseUrl()}/v1/ocr/pdf`, {
    method: "POST",
    body: form,
    signal: options.signal,
  });
  if (!res.ok) {
    let message = `OCR failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const raw = await res.json();
  return snakeToCamelDeep<PdfOcrResponse>(raw);
}

/** Local PaddleOCR on a page PNG/JPEG blob. */
export async function ocrPageImage(
  blob: Blob,
  filename = "page.png",
  options: {
    signal?: AbortSignal;
    profile?: "default" | "dense";
    ocrOptions?: PaddleOcrOptions;
  } = {},
): Promise<PageOcrResponse> {
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("profile", options.profile ?? "default");
  appendOcrOptionsToForm(form, options.ocrOptions);
  const res = await fetch(`${getInferenceApiBaseUrl()}/v1/ocr/page`, {
    method: "POST",
    body: form,
    signal: options.signal,
  });
  if (!res.ok) {
    let message = `OCR failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const raw = await res.json();
  return snakeToCamelDeep<PageOcrResponse>(raw);
}

export type OcrTileRect = { x: number; y: number; width: number; height: number };

export type OcrStreamMeta = {
  tiled: boolean;
  tileCount: number;
  tileSize: number;
  width: number;
  height: number;
};

export type OcrStreamTileEvent = {
  index: number;
  total: number;
  tile: OcrTileRect;
  lineCount?: number;
};

export type OcrStreamHandlers = {
  onMeta?: (meta: OcrStreamMeta) => void;
  onTileStart?: (event: OcrStreamTileEvent) => void;
  onTileDone?: (event: OcrStreamTileEvent) => void;
  onFinal?: (result: PageOcrResponse) => void;
  onStatus?: (message: string) => void;
  onError?: (message: string, code?: string) => void;
  onCancelled?: () => void;
};

export class OcrStreamCancelled extends Error {
  constructor() {
    super("OCR cancelled");
    this.name = "OcrStreamCancelled";
  }
}

function parseSseChunk(buffer: string): { events: Array<{ event: string; data: string }>; rest: string } {
  const events: Array<{ event: string; data: string }> = [];
  let rest = buffer;
  while (true) {
    const sep = rest.indexOf("\n\n");
    if (sep < 0) break;
    const block = rest.slice(0, sep);
    rest = rest.slice(sep + 2);
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length) events.push({ event, data: dataLines.join("\n") });
  }
  return { events, rest };
}

/** Local PaddleOCR on a page PNG/JPEG blob, streaming per-tile progress (SSE). */
export async function ocrPageImageStream(
  blob: Blob,
  filename = "page.png",
  options: {
    signal?: AbortSignal;
    profile?: "default" | "dense";
    ocrOptions?: PaddleOcrOptions;
  } = {},
  handlers: OcrStreamHandlers = {},
): Promise<PageOcrResponse> {
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("profile", options.profile ?? "default");
  appendOcrOptionsToForm(form, options.ocrOptions);
  const res = await fetch(`${getInferenceApiBaseUrl()}/v1/ocr/page/stream`, {
    method: "POST",
    body: form,
    signal: options.signal,
  });
  if (!res.ok) {
    let message = `OCR failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (!res.body) throw new Error("OCR stream returned no body.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: PageOcrResponse | null = null;
  let streamError: Error | null = null;

  const stop = async () => {
    try {
      await reader.cancel();
    } catch {
      // already closed
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseChunk(buffer);
      buffer = parsed.rest;
      for (const { event, data } of parsed.events) {
        if (event === "ping") continue;
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (event === "meta") {
          handlers.onMeta?.(snakeToCamelDeep<OcrStreamMeta>(payload));
        } else if (event === "status") {
          const message = String(payload.message ?? "").trim();
          if (message) handlers.onStatus?.(message);
        } else if (event === "tile_start") {
          handlers.onTileStart?.(snakeToCamelDeep<OcrStreamTileEvent>(payload));
        } else if (event === "tile_done") {
          handlers.onTileDone?.(snakeToCamelDeep<OcrStreamTileEvent>(payload));
        } else if (event === "final") {
          finalResult = snakeToCamelDeep<PageOcrResponse>(payload);
          handlers.onFinal?.(finalResult);
          await stop();
          return finalResult;
        } else if (event === "cancelled") {
          handlers.onCancelled?.();
          await stop();
          throw new OcrStreamCancelled();
        } else if (event === "error") {
          const message = String(payload.message ?? "OCR failed");
          const code = typeof payload.code === "string" ? payload.code : undefined;
          handlers.onError?.(message, code);
          streamError = new Error(message);
          await stop();
          throw streamError;
        }
      }
    }
  } finally {
    // Ensure the reader is released if we exit via done/error without stop().
  }

  if (streamError) throw streamError;
  if (!finalResult) {
    if (options.signal?.aborted) throw new OcrStreamCancelled();
    throw new Error("OCR stream ended without a result.");
  }
  return finalResult;
}
