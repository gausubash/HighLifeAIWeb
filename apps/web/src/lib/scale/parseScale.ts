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
  /(?:scale\s*[:=]?\s*)?(?:[1lI|]\s*[:\/\-．.]\s*)(\d{1,5})(?:\s*[@©]\s*|\s+)(?:iso\s*)?([ab]\s*[0-5])[a-z]?/i;

const SCALE_RATIO_ONLY_RE =
  /(?:scale\s*[:=]?\s*)?(?:[1lI|]\s*[:\/\-．.]\s*)(\d{1,5})\b/gi;

function normalizeOcrScaleText(text: string): string {
  if (!text) return "";
  let t = text
    .replace(/：/g, ":")
    .replace(/／/g, "/")
    .replace(/－/g, "-")
    .replace(/．/g, ".")
    .replace(/×/g, "x");
  t = t.replace(/(?<![0-9a-z])[lI|]\s*[:/]/gi, "1:");
  t = t.replace(/(scale\s*[:=]?\s*)1\s*[.\-]\s*(\d{2,5})\b/gi, "$11:$2");
  t = t.replace(/\b1\s*[.\-]\s*(\d{2,5})\s*([@©]|\bA\s*[0-5]\b)/gi, "1:$1 $2");
  t = t.replace(/\b([AB])\s*([0-5])[A-Za-z.]?\b/gi, "$1$2");
  t = t.replace(/[ \t]+/g, " ");
  return t;
}

function normalizePaperCode(paper: string | null): string | null {
  if (!paper) return null;
  const code = paper.toUpperCase().trim().replace("ISO ", "").replace(/ /g, "");
  const m = code.match(/^([AB][0-5])/);
  if (m && m[1] in A_PAPER_SIZES_MM) return m[1];
  if (code in A_PAPER_SIZES_MM) return code;
  return null;
}

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
    if (!match) continue;
    const scale = parseInt(match[1], 10);
    const paper = normalizePaperCode(match[2]);
    if (paper && scale >= 1 && scale <= 10000) {
      return { scale, paper };
    }
  }
  return null;
}

export function parseScaleRatio(text: string): number | null {
  if (!text) return null;
  const decl = parseScaleAndPaper(text);
  if (decl) return decl.scale;
  const normalized = normalizeOcrScaleText(text);
  let best: number | null = null;
  for (const candidate of [text, normalized]) {
    const re = new RegExp(SCALE_RATIO_ONLY_RE.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(candidate)) !== null) {
      const scale = parseInt(m[1], 10);
      if (scale >= 5 && scale <= 10000) {
        if (best === null || scale > best) best = scale;
      }
    }
  }
  return best;
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
