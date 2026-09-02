"use client";

import {
  formatOcrClassLabel,
  ocrLabelAboveQuad,
  ocrOverlayFontSize,
} from "./ocrOverlayFont";
import { useViewerStore } from "./useViewerStore";

export type OcrHighlightSource = "title_block" | "drawing";

export interface OcrHighlight {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  confidence?: number;
  source?: OcrHighlightSource;
  /** Exact OCR polygon in page pixels (usually a 4-point quad). */
  points?: { x: number; y: number }[];
}

interface OcrHighlightsSvgProps {
  highlights: OcrHighlight[];
  pageWidthPx: number;
  pageHeightPx: number;
}

const SOURCE_STYLE: Record<OcrHighlightSource, { stroke: string; fill: string; chip: string }> = {
  title_block: {
    stroke: "#4f46e5",
    fill: "rgba(79, 70, 229, 0.12)",
    chip: "#4f46e5",
  },
  drawing: {
    stroke: "#0f766e",
    fill: "rgba(13, 148, 136, 0.12)",
    chip: "#0f766e",
  },
};

function quadPoints(h: OcrHighlight, w: number, hh: number): { x: number; y: number }[] {
  if (h.points && h.points.length >= 3) return h.points;
  return [
    { x: h.x, y: h.y },
    { x: h.x + w, y: h.y },
    { x: h.x + w, y: h.y + hh },
    { x: h.x, y: h.y + hh },
  ];
}

function estimateLabelWidth(text: string, fontSize: number): number {
  return Math.max(fontSize * 2, text.length * fontSize * 0.62 + fontSize * 0.8);
}

/**
 * Exact OCR quads. The class chip sits on the top edge and is not clipped to the box.
 */
export function OcrHighlightsSvg({
  highlights,
  pageWidthPx,
  pageHeightPx,
}: OcrHighlightsSvgProps) {
  const ocrFontSize = useViewerStore((s) => s.ocrFontSize);
  if (!highlights.length || pageWidthPx < 1 || pageHeightPx < 1) return null;

  const strokeW = Math.max(1.1, pageWidthPx / 2200);

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      viewBox={`0 0 ${pageWidthPx} ${pageHeightPx}`}
      overflow="visible"
      preserveAspectRatio="none"
      shapeRendering="geometricPrecision"
      textRendering="geometricPrecision"
      aria-hidden
    >
      {highlights.map((h, idx) => {
        const safeText = (h.text || "").trim();
        const w = Math.max(0, h.width);
        const hh = Math.max(0, h.height);
        if (w < 1 || hh < 1) return null;

        const pts = quadPoints(h, w, hh);
        const poly = pts.map((p) => `${p.x},${p.y}`).join(" ");
        const fontSize = ocrOverlayFontSize(w, hh, safeText, pageWidthPx, ocrFontSize);
        const chipH = fontSize + 5;
        const place = ocrLabelAboveQuad(pts, 0);
        const label = formatOcrClassLabel(safeText, h.confidence);
        const chipW = estimateLabelWidth(label, fontSize);
        const style = SOURCE_STYLE[h.source ?? "drawing"];

        return (
          <g key={idx}>
            <polygon
              points={poly}
              fill={style.fill}
              stroke={style.stroke}
              strokeWidth={strokeW}
              strokeLinejoin="miter"
            />
            {label ? (
              <g transform={`translate(${place.x} ${place.y}) rotate(${place.rotate})`}>
                <rect x={0} y={-chipH} width={chipW} height={chipH} fill={style.chip} />
                <text
                  x={fontSize * 0.35}
                  y={-4}
                  fontSize={fontSize}
                  fontFamily="ui-sans-serif, system-ui, sans-serif"
                  fontWeight="600"
                  fill="#ffffff"
                  textAnchor="start"
                >
                  {label}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
