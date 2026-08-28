"use client";

import type { DetectedRegion } from "@/lib/api/floorPlanClient";
import { signedPlanUrl } from "@/lib/supabase/plans";

type PdfjsLibLike = {
  OPS?: Record<string, number>;
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (args: unknown) => { promise: Promise<PdfDocLike> };
};

type PdfDocLike = {
  getPage: (pageNumber: number) => Promise<PageLike>;
};

type ViewportLike = {
  width: number;
  height: number;
  transform: [number, number, number, number, number, number];
};

type PageLike = {
  getViewport: (args: { scale: number; rotation?: number }) => ViewportLike;
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[] }>;
};

type Matrix = [number, number, number, number, number, number];

type GraphicsState = {
  ctm: Matrix;
  lineWidth: number;
};

type Segment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  widthPx: number;
};

let workerConfigured = false;

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return {
    x: m[0] * x + m[2] * y + m[4],
    y: m[1] * x + m[3] * y + m[5],
  };
}

function lineWidthToPx(viewport: ViewportLike, ctm: Matrix, lineWidth: number): number {
  const m = multiply(viewport.transform, ctm);
  const sx = Math.hypot(m[0], m[1]);
  const sy = Math.hypot(m[2], m[3]);
  return Math.max(1, Math.abs(lineWidth) * ((sx + sy) / 2));
}

async function loadPdfJs(): Promise<PdfjsLibLike> {
  const pdfjsLib = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsLibLike;
  if (!workerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://unpkg.com/pdfjs-dist@6.2.108/legacy/build/pdf.worker.min.mjs";
    workerConfigured = true;
  }
  return pdfjsLib;
}

function isVectorCapable(kind: string | undefined): boolean {
  return kind === "vector" || kind === "hybrid";
}

function segmentLength(seg: Segment): number {
  return Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
}

function segmentAngleDeg(seg: Segment): number {
  return Math.abs((Math.atan2(seg.y2 - seg.y1, seg.x2 - seg.x1) * 180) / Math.PI);
}

function isNearlyAxisAligned(seg: Segment, toleranceDeg = 12): boolean {
  const angle = segmentAngleDeg(seg) % 180;
  return angle <= toleranceDeg || Math.abs(angle - 90) <= toleranceDeg;
}

function toWallPolygon(seg: Segment): { points: { x: number; y: number }[]; bbox: DetectedRegion["bboxPx"] } {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = -dy / len;
  const ny = dx / len;
  const half = Math.max(1.5, seg.widthPx / 2);
  const p1 = { x: seg.x1 + nx * half, y: seg.y1 + ny * half };
  const p2 = { x: seg.x2 + nx * half, y: seg.y2 + ny * half };
  const p3 = { x: seg.x2 - nx * half, y: seg.y2 - ny * half };
  const p4 = { x: seg.x1 - nx * half, y: seg.y1 - ny * half };
  const xs = [p1.x, p2.x, p3.x, p4.x];
  const ys = [p1.y, p2.y, p3.y, p4.y];
  return {
    points: [p1, p2, p3, p4],
    bbox: {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    },
  };
}

function decodeConstructPath(
  ops: Record<string, number>,
  viewport: ViewportLike,
  state: GraphicsState,
  args: unknown,
): Segment[] {
  if (!Array.isArray(args) || args.length < 2 || !Array.isArray(args[0])) return [];
  const pathOps = args[0] as number[];
  const packed = Array.from((args[1] as ArrayLike<number>) ?? []);
  const out: Segment[] = [];
  let i = 0;
  let cursor: { x: number; y: number } | null = null;
  let subpathStart: { x: number; y: number } | null = null;

  const pushLine = (x1: number, y1: number, x2: number, y2: number) => {
    const m = multiply(viewport.transform, state.ctm);
    const a = apply(m, x1, y1);
    const b = apply(m, x2, y2);
    out.push({
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      widthPx: lineWidthToPx(viewport, state.ctm, state.lineWidth),
    });
  };

  for (const op of pathOps) {
    if (op === ops.moveTo) {
      const x = packed[i++];
      const y = packed[i++];
      cursor = { x, y };
      subpathStart = { x, y };
    } else if (op === ops.lineTo) {
      const x = packed[i++];
      const y = packed[i++];
      if (cursor) pushLine(cursor.x, cursor.y, x, y);
      cursor = { x, y };
    } else if (op === ops.curveTo) {
      i += 4;
      const x = packed[i++];
      const y = packed[i++];
      cursor = { x, y };
    } else if (op === ops.curveTo2 || op === ops.curveTo3) {
      i += 2;
      const x = packed[i++];
      const y = packed[i++];
      cursor = { x, y };
    } else if (op === ops.rectangle) {
      const x = packed[i++];
      const y = packed[i++];
      const w = packed[i++];
      const h = packed[i++];
      pushLine(x, y, x + w, y);
      pushLine(x + w, y, x + w, y + h);
      pushLine(x + w, y + h, x, y + h);
      pushLine(x, y + h, x, y);
      cursor = { x, y };
      subpathStart = { x, y };
    } else if (op === ops.closePath) {
      if (cursor && subpathStart) pushLine(cursor.x, cursor.y, subpathStart.x, subpathStart.y);
      cursor = subpathStart;
    }
  }
  return out;
}

function rankWallSegments(
  segments: Segment[],
  targetWidthPx: number,
  targetHeightPx: number,
): Segment[] {
  const minLong = Math.max(24, Math.min(targetWidthPx, targetHeightPx) * 0.03);
  return segments.filter((seg) => {
    const length = segmentLength(seg);
    if (length < minLong) return false;
    if (!isNearlyAxisAligned(seg)) return false;
    if (seg.widthPx < 1.5 || seg.widthPx > 24) return false;
    // Drop likely dimension or hatch lines.
    if (seg.widthPx < 2.25 && length < minLong * 2.2) return false;
    return true;
  });
}

export async function detectVectorPdfWalls(args: {
  storagePath: string;
  sourceFileName: string;
  pageNumber: number;
  targetWidthPx: number;
  targetHeightPx: number;
  graphicsKind?: string;
  signal?: AbortSignal;
}): Promise<{ regions: DetectedRegion[]; warning: string | null }> {
  const {
    storagePath,
    sourceFileName,
    pageNumber,
    targetWidthPx,
    targetHeightPx,
    graphicsKind,
    signal,
  } = args;
  if (!storagePath || !sourceFileName) {
    throw new Error("Original PDF is not available for vector detect.");
  }
  if (!isVectorCapable(graphicsKind)) {
    throw new Error("PDF vector walls only works on vector or hybrid PDF pages.");
  }
  const ext = sourceFileName.toLowerCase().endsWith(".pdf") ? ".pdf" : "";
  if (!ext) {
    throw new Error("Original source is not a PDF.");
  }
  const url = await signedPlanUrl(`${storagePath}/source${ext}`);
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Could not download source PDF (${res.status}).`);
  }
  const data = await res.arrayBuffer();
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  const pdfjsLib = await loadPdfJs();
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const page = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const list = await page.getOperatorList();
  const ops = pdfjsLib.OPS ?? {};
  const strokeOps = new Set(
    [
      ops.stroke,
      ops.closeStroke,
      ops.fillStroke,
      ops.eoFillStroke,
      ops.closeFillStroke,
      ops.closeEOFillStroke,
    ].filter((v): v is number => typeof v === "number"),
  );

  const stack: GraphicsState[] = [];
  let state: GraphicsState = { ctm: IDENTITY, lineWidth: 1 };
  let pending: Segment[] = [];
  const stroked: Segment[] = [];

  for (let idx = 0; idx < list.fnArray.length; idx++) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const fn = list.fnArray[idx];
    const opArgs = list.argsArray[idx];
    if (fn === ops.save) {
      stack.push({ ctm: [...state.ctm] as Matrix, lineWidth: state.lineWidth });
      continue;
    }
    if (fn === ops.restore) {
      state = stack.pop() ?? { ctm: IDENTITY, lineWidth: 1 };
      continue;
    }
    if (fn === ops.transform && Array.isArray(opArgs) && opArgs.length >= 6) {
      state = {
        ...state,
        ctm: multiply(state.ctm, [
          Number(opArgs[0]),
          Number(opArgs[1]),
          Number(opArgs[2]),
          Number(opArgs[3]),
          Number(opArgs[4]),
          Number(opArgs[5]),
        ]),
      };
      continue;
    }
    if (fn === ops.setLineWidth && Array.isArray(opArgs) && opArgs.length) {
      state = { ...state, lineWidth: Number(opArgs[0]) || 1 };
      continue;
    }
    if (fn === ops.constructPath) {
      pending = decodeConstructPath(ops, viewport, state, opArgs);
      continue;
    }
    if (strokeOps.has(fn)) {
      stroked.push(...pending);
      pending = [];
      continue;
    }
    if (fn === ops.endPath) {
      pending = [];
    }
  }

  const walls = rankWallSegments(stroked, targetWidthPx, targetHeightPx);
  const regions: DetectedRegion[] = walls.map((seg, index) => {
    const poly = toWallPolygon(seg);
    return {
      id: `vector-wall-${pageNumber}-${index}`,
      type: "wall",
      label: "Wall",
      confidence: 0.82,
      polygonPx: poly.points,
      bboxPx: poly.bbox,
      attributes: {
        roomType: "wall",
        label: "Wall",
        source: "vector_pdf",
        lineWidthPx: Number(seg.widthPx.toFixed(2)),
        lineLengthPx: Number(segmentLength(seg).toFixed(1)),
      },
    };
  });

  const warning =
    regions.length === 0
      ? "No vector wall candidates found. This PDF may be rasterized, flattened, or use very thin CAD strokes."
      : `Vector wall candidates: ${regions.length} from ${stroked.length} stroked path segments.`;
  return { regions, warning };
}
