/**
 * Client-side scale parsing — ported from BuildPro scale_converter.py.
 * Parses title-block text like "1:200 @ A3" with OCR-noise tolerance.
 */

const MM_PER_INCH = 25.4;

export const A_PAPER_SIZES_MM: Record<string, [number, number]> = {
  A0: [841, 1189],
  A1: [594, 841],
  A2: [420, 594],
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
};

const SCALE_PAPER_RE =
  /(?:scale\s*[:=]?\s*)?(?:[1lI|]\s*[:/\-．.=]\s*)(\d{1,5})\s*[@©]\s*(?:iso\s*)?([ab]\s*[0-5])[a-z]?/i;

const SCALE_RATIO_ONLY_RE =
  /(?:scale\s*[:=]?\s*)?(?:[1lI|]\s*[:/\-．.=]\s*)(\d{1,5})\b/gi;

const PAPER_ONLY_RE = /(?:@|©)\s*(?:iso\s*)?([ab]\s*[0-5])[a-z]?\b/i;

export function normalizeOcrScaleText(text: string): string {
  if (!text) return "";
  let t = text
    .replace(/：/g, ":")
    .replace(/／/g, "/")
    .replace(/－/g, "-")
    .replace(/．/g, ".")
    .replace(/×/g, "x")
    .replace(/©/g, "@");

  // Fix OCR letter 'O'/'o' replacing zero in scale ratios: 1:10O -> 1:100, 1:5O -> 1:50
  t = t.replace(/\b1\s*[:/\-.]\s*(\d{1,4})[Oo]\b/g, "1:$10");
  t = t.replace(/\b1\s*[:/\-.]\s*(\d{1,3})[Oo][Oo]\b/g, "1:$100");
  t = t.replace(/\b1\s*[:/\-.]\s*[Oo]\b/g, "1:0");

  // Normalize "1 to 100", "1 - 100", "1 = 100", "1 / 100", "1 : 100"
  t = t.replace(/\b1\s+(?:to|TO)\s+(\d{1,5})\b/g, "1:$1");
  t = t.replace(/\b([1lI|])\s*[:/\-．.=]\s*(\d{1,5})\b/g, "1:$2");

  // Normalize leading OCR pipe/l/I
  t = t.replace(/(?<![0-9a-z])[lI|]\s*[:/]/gi, "1:");
  t = t.replace(/(scale\s*[:=]?\s*)1\s*[.\-]\s*(\d{2,5})\b/gi, "$11:$2");
  t = t.replace(/\b1\s*[.\-]\s*(\d{2,5})\s*([@©]|\bA\s*[0-5]\b)/gi, "1:$1 $2");

  // Fix spaces in paper codes: "A 1" -> "A1", "ISO A 3" -> "ISO A3"
  t = t.replace(/\b([AB])\s*([0-5])[A-Za-z.]?\b/gi, "$1$2");
  t = t.replace(/[ \t]+/g, " ");
  return t;
}

export function normalizePaperCode(paper: string | null): string | null {
  if (!paper) return null;
  const code = paper.toUpperCase().trim().replace("ISO ", "").replace(/ /g, "");
  const m = code.match(/^([AB][0-5])/);
  if (m && m[1] in A_PAPER_SIZES_MM) return m[1];
  if (code in A_PAPER_SIZES_MM) return code;
  return null;
}

/**
 * Parses single string containing both scale (1:N) and paper (@ AX).
 * Examples: "SCALE 1:100 @ A1", "1:200 @ A3", "1:50@A1".
 */
export function parseScaleAndPaper(text: string): { scale: number; paper: string } | null {
  if (!text) return null;
  const normalized = normalizeOcrScaleText(text);
  const candidates = [
    text,
    normalized,
    normalized.replace(/\s+/g, " "),
    normalized.replace(/\s*@\s*/g, "@"),
    normalized.replace(/ /g, ""),
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);

    const match = SCALE_PAPER_RE.exec(candidate);
    if (match) {
      const scale = parseInt(match[1], 10);
      const paper = normalizePaperCode(match[2]);
      if (paper && scale >= 1 && scale <= 10000) {
        return { scale, paper };
      }
    }
  }
  return null;
}

/**
 * Parses drawing scale ratio in 1:N format (e.g. "SCALE 1:100", "1:200", "1/50").
 * Always requires the "1:" prefix.
 */
export function parseScaleRatio(text: string): number | null {
  if (!text) return null;
  const decl = parseScaleAndPaper(text);
  if (decl) return decl.scale;
  const normalized = normalizeOcrScaleText(text);

  // 1. Prioritize lines explicitly containing the word "scale"
  const lines = text.split(/\r?\n/).concat(normalized.split(/\r?\n/));
  for (const line of lines) {
    if (/scale/i.test(line)) {
      const match = /(?:scale\s*[:=]?\s*)?[1lI|]\s*[:/\-．.=]\s*(\d{1,5})\b/i.exec(line);
      if (match) {
        const val = parseInt(match[1], 10);
        if (val >= 1 && val <= 10000) return val;
      }
    }
  }

  // 2. Standard architectural scale ratios (1:N)
  const ARCH_SCALES = [
    50, 100, 200, 500, 20, 25, 75, 125, 150, 250, 300, 400, 750, 1000, 1250, 1500,
    2000, 2500, 5000, 10, 5, 2, 1,
  ];
  for (const candidate of [text, normalized]) {
    const re = /(?:[1lI|]\s*[:/\-．.=]\s*)(\d{1,5})\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(candidate)) !== null) {
      const scale = parseInt(m[1], 10);
      if (ARCH_SCALES.includes(scale)) {
        return scale;
      }
    }
  }

  // 3. Fallback to any valid 1:N ratio
  let best: number | null = null;
  for (const candidate of [text, normalized]) {
    const re = new RegExp(SCALE_RATIO_ONLY_RE.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(candidate)) !== null) {
      const scale = parseInt(m[1], 10);
      if (scale >= 1 && scale <= 10000) {
        if (best === null || scale > best) best = scale;
      }
    }
  }
  return best;
}

/**
 * Parses paper size from text strictly preceded by '@' (e.g. "@ A1", "@ A3", "@A1", "@ ISO A1").
 */
export function parsePaperFromText(text: string): string | null {
  if (!text) return null;
  for (const candidate of [text, normalizeOcrScaleText(text)]) {
    if (!candidate) continue;
    const match = PAPER_ONLY_RE.exec(candidate);
    if (match) {
      const paper = normalizePaperCode(match[1]);
      if (paper) return paper;
    }
  }
  return null;
}

export function formatScaleDeclaration(scale: number, paper?: string | null): string {
  return paper ? `1:${scale} @ ${paper}` : `1:${scale}`;
}

type OcrScaleLine = {
  text?: string | null;
  bbox?: [number, number][] | null;
  confidence?: number | null;
};

type LineBox = { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number; w: number; h: number };

function ocrLineBox(bbox: [number, number][] | null | undefined): LineBox | null {
  if (!Array.isArray(bbox) || bbox.length < 2) return null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const pt of bbox) {
    if (!Array.isArray(pt) || pt.length < 2) continue;
    const x = Number(pt[0]);
    const y = Number(pt[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    xs.push(x);
    ys.push(y);
  }
  if (xs.length < 2) return null;
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const x1 = Math.max(...xs);
  const y1 = Math.max(...ys);
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w, h };
}

function tokensSpatiallyNearby(a: LineBox, b: LineBox): boolean {
  const h = Math.max(a.h, b.h, 10);
  const gapX = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
  const gapY = Math.max(0, a.y0 - b.y1, b.y0 - a.y1);
  // Title-block tokens sit on one row or stacked in the same cell.
  return gapX <= h * 12 && gapY <= h * 5;
}

function scaleTokensNearby(
  a: { box: LineBox | null; index: number },
  b: { box: LineBox | null; index: number },
): boolean {
  if (a.box && b.box) return tokensSpatiallyNearby(a.box, b.box);
  return Math.abs(a.index - b.index) <= 2;
}

/**
 * Normalizes OCR scale output to `1:N @ AX` when ratio (1:N) and paper (@ AX) are present.
 * When OCR splits "SCALE", "1:100", and "@ A1" across lines, tokens are clustered by
 * bounding-box position (not list order). Falls back to nearby list indices when boxes are missing.
 */
export function canonicalScaleText(
  scaleText: string | null | undefined,
  paperSize?: string | null,
  extraLines?: OcrScaleLine[],
): string | null {
  if (!scaleText?.trim() && !paperSize && !extraLines?.length) return null;

  // 1. Check if scaleText itself has combined 1:N @ AX
  if (scaleText) {
    const directDecl = parseScaleAndPaper(scaleText);
    if (directDecl) return formatScaleDeclaration(directDecl.scale, directDecl.paper);
  }

  // 2. Check each line individually for combined 1:N @ AX
  if (extraLines) {
    for (const line of extraLines) {
      const lineDecl = parseScaleAndPaper(line.text ?? "");
      if (lineDecl) return formatScaleDeclaration(lineDecl.scale, lineDecl.paper);
    }
  }

  // 3. Cluster SCALE / 1:N / @ AX by position
  if (extraLines && extraLines.length > 0) {
    type Token = { index: number; box: LineBox | null; text: string };

    const labels: Token[] = [];
    const ratios: (Token & { scale: number; onScaleLine: boolean })[] = [];
    const papers: (Token & { paper: string })[] = [];

    extraLines.forEach((line, index) => {
      const text = line.text ?? "";
      if (!text.trim()) return;
      const box = ocrLineBox(line.bbox);
      const token = { index, box, text };
      const ratio = parseScaleRatio(text);
      const paper = parsePaperFromText(text);
      if (/\bscale\b/i.test(text)) labels.push(token);
      if (ratio) {
        ratios.push({ ...token, scale: ratio, onScaleLine: /\bscale\b/i.test(text) });
      }
      if (paper) papers.push({ ...token, paper });
    });

    const nearScaleLabel = (token: Token) =>
      labels.some((label) => scaleTokensNearby(token, label));

    let bestPair: { scale: number; paper: string; score: number } | null = null;
    for (const ratio of ratios) {
      for (const paper of papers) {
        if (!scaleTokensNearby(ratio, paper)) continue;
        const labeled = ratio.onScaleLine || nearScaleLabel(ratio) || nearScaleLabel(paper);
        let score = labeled ? 20 : 8;
        if (ratio.box && paper.box) {
          score -= Math.hypot(ratio.box.cx - paper.box.cx, ratio.box.cy - paper.box.cy) / 40;
        } else {
          score -= Math.abs(ratio.index - paper.index);
        }
        if (!bestPair || score > bestPair.score) {
          bestPair = { scale: ratio.scale, paper: paper.paper, score };
        }
      }
    }

    if (bestPair) {
      return formatScaleDeclaration(bestPair.scale, bestPair.paper);
    }

    if (ratios.length > 0) {
      const labeled = ratios.filter((r) => r.onScaleLine || nearScaleLabel(r));
      const pool = labeled.length ? labeled : ratios;
      pool.sort((a, b) => (b.onScaleLine ? 1 : 0) - (a.onScaleLine ? 1 : 0));
      const paperFromParam =
        paperSize && (parsePaperFromText(scaleText ?? "") || scaleText?.includes("@"))
          ? normalizePaperCode(paperSize)
          : null;
      return formatScaleDeclaration(pool[0].scale, paperFromParam);
    }
  }

  // 4. Fallback ratio from scaleText
  const singleRatio = parseScaleRatio(scaleText ?? "");
  if (singleRatio) {
    const singlePaper =
      parsePaperFromText(scaleText ?? "") ?? (paperSize ? normalizePaperCode(paperSize) : null);
    return formatScaleDeclaration(singleRatio, singlePaper);
  }

  return scaleText?.trim() || null;
}

function pointsToMm(pt: number): number {
  return (pt * MM_PER_INCH) / 72.0;
}

export function inferPaperSizeFromPoints(
  widthPt: number,
  heightPt: number,
  toleranceMm = 8,
): { name: string; shortMm: number; longMm: number } | null {
  const wMm = pointsToMm(Math.min(widthPt, heightPt));
  const hMm = pointsToMm(Math.max(widthPt, heightPt));
  let best: { name: string; shortMm: number; longMm: number } | null = null;
  let bestDelta = toleranceMm + 1;

  const isoSizes: [string, number, number][] = [
    ["A0", 841, 1189],
    ["A1", 594, 841],
    ["A2", 420, 594],
    ["A3", 297, 420],
    ["A4", 210, 297],
  ];
  for (const [name, short, long] of isoSizes) {
    const delta = Math.abs(wMm - short) + Math.abs(hMm - long);
    if (delta <= toleranceMm && delta < bestDelta) {
      bestDelta = delta;
      best = { name, shortMm: short, longMm: long };
    }
  }
  if (best) return best;
  return { name: `Custom ${Math.round(wMm)}×${Math.round(hMm)} mm`, shortMm: wMm, longMm: hMm };
}

export interface ScaleInfo {
  scaleRatio: number | null;
  paper: string | null;
  paperFromPdf: string | null;
  pageWidthPt: number;
  pageHeightPt: number;
  pageWidthMm: number;
  pageHeightMm: number;
  method: string;
  confidence: number;
  pixelsPerMeter: number | null;
  scaleLabel: string | null;
}

/** Short sidebar label for how the current drawing scale was set. */
export function scaleMethodLabel(method: string | null | undefined): string {
  switch (method) {
    case "title_block_text":
    case "auto_detect_scale":
    case "ocr_scale":
      return "OCR";
    case "manual_scale_paper":
      return "Manual";
    case "manual_two_point":
      return "Measure";
    case "paper_size_auto":
      return "Auto";
    default:
      return method?.trim() ? method.replace(/_/g, " ") : "—";
  }
}

/**
 * Map 1:N @ paper onto a rendered page image.
 * Landscape uses the long paper edge as image width; portrait uses the short edge.
 */
export function pixelsPerMeterFromScaleAndPaper(opts: {
  scaleRatio: number;
  paper: string;
  renderWidthPx: number;
  renderHeightPx: number;
}): number {
  const { scaleRatio, paper, renderWidthPx, renderHeightPx } = opts;
  if (!(scaleRatio > 0) || !(renderWidthPx > 0)) {
    throw new Error("Scale ratio and page width must be greater than zero");
  }
  const size = A_PAPER_SIZES_MM[paper];
  if (!size) {
    throw new Error(`Unknown paper size: ${paper}`);
  }
  const [shortMm, longMm] = size;
  const landscape = renderWidthPx >= renderHeightPx;
  const sheetWidthMm = landscape ? longMm : shortMm;
  const realWidthM = (sheetWidthMm / 1000) * scaleRatio;
  return renderWidthPx / realWidthM;
}

/**
 * Live px/m from draft 1:N, paper, and DPI. When a current raster size is known,
 * DPI is applied as a scale of that raster; otherwise paper mm × DPI is used.
 */
export function previewPixelsPerMeterFromScalePaperDpi(opts: {
  scaleRatio: number;
  paper: string;
  dpi: number;
  renderWidthPx?: number;
  renderHeightPx?: number;
  renderDpi?: number;
}): number | null {
  const { scaleRatio, paper, dpi, renderWidthPx, renderHeightPx, renderDpi } = opts;
  if (!(scaleRatio >= 1 && scaleRatio <= 10000) || !(dpi > 0) || !(paper in A_PAPER_SIZES_MM)) {
    return null;
  }
  const size = A_PAPER_SIZES_MM[paper];
  if (!size) return null;
  const landscape = (renderWidthPx ?? 0) >= (renderHeightPx ?? 0);
  const [shortMm, longMm] = size;
  const sheetWidthMm = landscape ? longMm : shortMm;
  const sheetHeightMm = landscape ? shortMm : longMm;
  const predictedWidthPx =
    renderWidthPx && renderDpi && renderDpi > 0
      ? renderWidthPx * (dpi / renderDpi)
      : (sheetWidthMm / MM_PER_INCH) * dpi;
  const predictedHeightPx =
    renderHeightPx && renderDpi && renderDpi > 0
      ? renderHeightPx * (dpi / renderDpi)
      : (sheetHeightMm / MM_PER_INCH) * dpi;
  try {
    return pixelsPerMeterFromScaleAndPaper({
      scaleRatio,
      paper,
      renderWidthPx: predictedWidthPx,
      renderHeightPx: predictedHeightPx,
    });
  } catch {
    return null;
  }
}

export function computeScaleInfo(opts: {
  scaleText: string | null;
  pageWidthPt: number;
  pageHeightPt: number;
  renderWidthPx: number;
  renderHeightPx: number;
  renderScale: number;
}): ScaleInfo {
  const { scaleText, pageWidthPt, pageHeightPt, renderWidthPx, renderHeightPx, renderScale } = opts;
  const pageWidthMm = pointsToMm(Math.min(pageWidthPt, pageHeightPt));
  const pageHeightMm = pointsToMm(Math.max(pageWidthPt, pageHeightPt));

  const pdfPaper = inferPaperSizeFromPoints(pageWidthPt, pageHeightPt);
  const paperFromPdf = pdfPaper?.name ?? null;

  // Effective DPI from render
  const isLandscape = renderWidthPx > renderHeightPx;
  const sheetW = isLandscape ? pageHeightMm : pageWidthMm;
  const dpi = (renderWidthPx / renderScale) * MM_PER_INCH / sheetW;

  let scaleRatio: number | null = null;
  let paper: string | null = null;
  let method = "paper_size_auto";
  let confidence = 0.6;
  let scaleLabel: string | null = paperFromPdf;

  if (scaleText) {
    const decl = parseScaleAndPaper(scaleText);
    if (decl) {
      scaleRatio = decl.scale;
      paper = decl.paper;
      method = "title_block_text";
      confidence = 0.95;
      scaleLabel = `1:${scaleRatio} @ ${paper}`;
    } else {
      scaleRatio = parseScaleRatio(scaleText);
      if (scaleRatio) {
        method = "title_block_text";
        confidence = 0.7;
        scaleLabel = `1:${scaleRatio}`;
      }
    }
  }

  // pixels per meter
  let pixelsPerMeter: number | null = null;
  if (scaleRatio && scaleRatio > 0) {
    const mmPerPx = MM_PER_INCH / dpi;
    const realMmPerPx = mmPerPx * scaleRatio;
    const realMPerPx = realMmPerPx / 1000;
    pixelsPerMeter = realMPerPx > 0 ? 1 / realMPerPx : null;
  } else {
    // 1:1 paper assumption
    const widthM = pageWidthMm / 1000;
    if (widthM > 0) {
      pixelsPerMeter = (renderWidthPx / renderScale) / widthM;
    }
  }

  return {
    scaleRatio,
    paper,
    paperFromPdf,
    pageWidthPt,
    pageHeightPt,
    pageWidthMm: Math.round(pageWidthMm * 10) / 10,
    pageHeightMm: Math.round(pageHeightMm * 10) / 10,
    method,
    confidence,
    pixelsPerMeter,
    scaleLabel,
  };
}

export type PointPx = { x: number; y: number };

/** Euclidean distance in render/image pixels. */
export function pixelDistance(a: PointPx, b: PointPx): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

/**
 * Two-point calibration: user picks two points on a known real length
 * (dimension line, wall, scale bar) → pixelsPerMeter = px / meters.
 */
export function calibrateFromTwoPoints(
  base: ScaleInfo,
  opts: {
    pointA: PointPx;
    pointB: PointPx;
    realLength: number;
    realUnit: "m" | "mm";
  },
): ScaleInfo {
  const { pointA, pointB, realLength, realUnit } = opts;
  if (!(realLength > 0)) {
    throw new Error("Real length must be greater than zero");
  }

  const px = pixelDistance(pointA, pointB);
  if (!(px > 0)) {
    throw new Error("The two points must be distinct");
  }

  const realMeters = realUnit === "mm" ? realLength / 1000 : realLength;
  const pixelsPerMeter = px / realMeters;

  const lengthLabel =
    realUnit === "mm" ? `${realLength} mm` : `${realLength} m`;

  return {
    ...base,
    // Keep prior title-block 1:N if present; two-point owns pixelsPerMeter.
    method: "manual_two_point",
    confidence: 0.99,
    pixelsPerMeter,
    scaleLabel: `2-point: ${lengthLabel} ↔ ${px.toFixed(1)} px`,
  };
}

/**
 * User-entered drawing scale, e.g. 1:200 on A3 — no click-to-measure.
 */
export function calibrateFromScaleAndPaper(
  base: ScaleInfo,
  opts: {
    scaleRatio: number;
    paper: string;
    renderWidthPx: number;
    renderHeightPx: number;
  },
): ScaleInfo {
  const { scaleRatio, paper, renderWidthPx, renderHeightPx } = opts;
  const code = paper.toUpperCase().trim();
  if (!(code in A_PAPER_SIZES_MM)) {
    throw new Error(`Unknown paper size: ${paper}`);
  }
  if (!(scaleRatio >= 1 && scaleRatio <= 10000)) {
    throw new Error("Scale must be between 1:1 and 1:10000");
  }

  const pixelsPerMeter = pixelsPerMeterFromScaleAndPaper({
    scaleRatio,
    paper: code,
    renderWidthPx,
    renderHeightPx,
  });

  return {
    ...base,
    scaleRatio,
    paper: code,
    method: "manual_scale_paper",
    confidence: 0.9,
    pixelsPerMeter,
    scaleLabel: `1:${scaleRatio} @ ${code}`,
  };
}

/** Convert a pixel span to real length using calibrated px/m. */
export function lengthFromPixels(
  px: number,
  pixelsPerMeter: number,
): { meters: number; millimetres: number } {
  if (!(pixelsPerMeter > 0)) {
    throw new Error("pixelsPerMeter must be greater than zero");
  }
  const meters = px / pixelsPerMeter;
  return { meters, millimetres: meters * 1000 };
}

export function formatMeasuredLength(meters: number): string {
  if (meters >= 1) return `${meters.toFixed(3)} m`;
  return `${(meters * 1000).toFixed(1)} mm`;
}
