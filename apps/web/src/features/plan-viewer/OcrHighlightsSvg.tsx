"use client";

export interface OcrHighlight {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

interface OcrHighlightsSvgProps {
  highlights: OcrHighlight[];
  pageWidthPx: number;
  pageHeightPx: number;
}

/**
 * Vector SVG overlay for OCR boxes and labels — stays sharp when the page is CSS-zoomed.
 * Konva canvas text rasterizes and blurs under zoom; SVG text does not.
 */
export function OcrHighlightsSvg({
  highlights,
  pageWidthPx,
  pageHeightPx,
}: OcrHighlightsSvgProps) {
  if (!highlights.length || pageWidthPx < 1 || pageHeightPx < 1) return null;

  const strokeW = Math.max(1.5, pageWidthPx / 2500);
  const pad = Math.max(2, pageWidthPx / 4000);

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${pageWidthPx} ${pageHeightPx}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {highlights.map((h, idx) => {
        const safeText = (h.text || "").trim();
        const w = Math.max(0, h.width);
        const hh = Math.max(0, h.height);
        if (w < 1 || hh < 1) return null;

        const fontSize = Math.max(14, Math.min(hh * 0.82, hh - pad * 2, 64));
        const clipId = `ocr-clip-${idx}`;

        return (
          <g key={idx}>
            <defs>
              <clipPath id={clipId}>
                <rect x={h.x} y={h.y} width={w} height={hh} />
              </clipPath>
            </defs>
            <rect
              x={h.x}
              y={h.y}
              width={w}
              height={hh}
              rx={pad}
              fill="rgba(99, 102, 241, 0.14)"
              stroke="#4338ca"
              strokeWidth={strokeW}
            />
            {safeText ? (
              <text
                x={h.x + pad}
                y={h.y + hh / 2}
                clipPath={`url(#${clipId})`}
                dominantBaseline="middle"
                fontSize={fontSize}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                fontWeight="600"
                fill="#1e1b4b"
                stroke="rgba(255,255,255,0.92)"
                strokeWidth={Math.max(2, fontSize * 0.18)}
                paintOrder="stroke"
              >
                {safeText}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
