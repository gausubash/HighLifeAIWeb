"use client";

import { classSwatch } from "@/features/plan-editor/styles";

export type OcrRoomMarker = {
  x: number;
  y: number;
  label: string;
  unitLabel?: string | null;
};

interface OcrRoomMarkersSvgProps {
  markers: OcrRoomMarker[];
  pageWidthPx: number;
  pageHeightPx: number;
}

/**
 * Pins for spatial OCR room labels (living, kitchen, bed…) assigned to units.
 */
export function OcrRoomMarkersSvg({
  markers,
  pageWidthPx,
  pageHeightPx,
}: OcrRoomMarkersSvgProps) {
  if (!markers.length || pageWidthPx < 1 || pageHeightPx < 1) return null;

  const r = Math.max(5, pageWidthPx / 500);
  const fontSize = Math.max(9, pageWidthPx / 420);
  const chipPad = fontSize * 0.35;

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
      {markers.map((m, idx) => {
        const fill = classSwatch(m.label);
        const chipW = Math.max(fontSize * 2.2, m.label.length * fontSize * 0.55 + chipPad * 2);
        const chipH = fontSize + chipPad * 2;
        const chipX = m.x - chipW / 2;
        const chipY = m.y - r - chipH - 4;

        return (
          <g key={`${m.label}-${idx}-${Math.round(m.x)}-${Math.round(m.y)}`}>
            <circle
              cx={m.x}
              cy={m.y}
              r={r}
              fill={fill}
              stroke="#0f172a"
              strokeWidth={Math.max(1, r * 0.35)}
            />
            <rect
              x={chipX}
              y={chipY}
              width={chipW}
              height={chipH}
              rx={2}
              fill="#0f172a"
              opacity={0.88}
            />
            <text
              x={m.x}
              y={chipY + chipH - chipPad}
              textAnchor="middle"
              fontSize={fontSize}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fontWeight="600"
              fill="#ffffff"
            >
              {m.label.length > 16 ? `${m.label.slice(0, 14)}…` : m.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
