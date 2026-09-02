/** Overlay type size in page pixels. */
export const OCR_OVERLAY_FONT_DEFAULT = 10;
export const OCR_OVERLAY_FONT_MIN = 4;
export const OCR_OVERLAY_FONT_MAX = 48;

export function clampOcrOverlayFontSize(size: number): number {
  if (!Number.isFinite(size)) return OCR_OVERLAY_FONT_DEFAULT;
  return Math.min(OCR_OVERLAY_FONT_MAX, Math.max(OCR_OVERLAY_FONT_MIN, Math.round(size)));
}

export function ocrTextAlongQuad(pts: { x: number; y: number }[]): {
  x: number;
  y: number;
  rotate: number;
} {
  const origin = pts[0] ?? { x: 0, y: 0 };
  const along = pts[1] ?? { x: origin.x + 1, y: origin.y };
  return {
    x: origin.x,
    y: origin.y,
    rotate: (Math.atan2(along.y - origin.y, along.x - origin.x) * 180) / Math.PI,
  };
}

function topEdgeLeftToRight(pts: { x: number; y: number }[]): {
  left: { x: number; y: number };
  right: { x: number; y: number };
} {
  if (pts.length < 2) {
    const p = pts[0] ?? { x: 0, y: 0 };
    return { left: p, right: { x: p.x + 1, y: p.y } };
  }
  let bestI = 0;
  let bestMidY = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const midY = (a.y + b.y) / 2;
    if (midY < bestMidY) {
      bestMidY = midY;
      bestI = i;
    }
  }
  const a = pts[bestI]!;
  const b = pts[(bestI + 1) % pts.length]!;
  return a.x <= b.x ? { left: a, right: b } : { left: b, right: a };
}

/** Place a CV-style label on the screen-space top edge, never inside the box. */
export function ocrLabelAboveQuad(
  pts: { x: number; y: number }[],
  liftPx: number,
): { x: number; y: number; rotate: number } {
  const { left, right } = topEdgeLeftToRight(pts);
  const ex = right.x - left.x;
  const ey = right.y - left.y;
  const len = Math.hypot(ex, ey) || 1;
  let nx = -ey / len;
  let ny = ex / len;
  const cx = pts.reduce((s, p) => s + p.x, 0) / Math.max(1, pts.length);
  const cy = pts.reduce((s, p) => s + p.y, 0) / Math.max(1, pts.length);
  if ((cx - left.x) * nx + (cy - left.y) * ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  const lift = Math.max(0, liftPx);
  return {
    x: left.x + nx * lift,
    y: left.y + ny * lift,
    rotate: (Math.atan2(ey, ex) * 180) / Math.PI,
  };
}

export function formatOcrClassLabel(text: string, confidence?: number): string {
  const label = text.trim();
  if (!label) return "";
  if (confidence == null || !Number.isFinite(confidence)) return label;
  const pct = Math.max(0, Math.min(100, Math.round(confidence * 100)));
  return `${label}  ${pct}%`;
}

export function ocrOverlayFontSize(
  _boxWidth?: number,
  _boxHeight?: number,
  _text?: string,
  _pageWidthPx?: number,
  sizePx = OCR_OVERLAY_FONT_DEFAULT,
): number {
  return clampOcrOverlayFontSize(sizePx);
}
