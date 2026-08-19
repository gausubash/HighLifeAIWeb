"use client";

import type { AnalysisResult, Polygon } from "@highlife/shared-types";
import { useCallback, useRef } from "react";
import { useViewerStore } from "./useViewerStore";
import { formatArea, formatConfidence } from "@/lib/utils";

interface PlanViewerProps {
  result: AnalysisResult;
}

function polygonToPoints(polygon: Polygon): string {
  return polygon.map(([x, y]) => `${x},${y}`).join(" ");
}

function confidenceColor(confidence: number, reviewRequired: boolean): string {
  if (reviewRequired) return "#f59e0b";
  if (confidence >= 0.85) return "#22c55e";
  if (confidence >= 0.7) return "#eab308";
  return "#ef4444";
}

const SPACE_COLORS: Record<string, string> = {
  common_corridor: "#dbeafe",
  room: "#fef3c7",
  balcony: "#d1fae5",
  private_hall: "#f3e8ff",
};

export function PlanViewer({ result }: PlanViewerProps) {
  const page = result.pages[0];
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const { zoom, panX, panY, selectedId, visibleLayers, setZoom, setPan, resetView, selectObject } =
    useViewerStore();

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setZoom(zoom + delta);
    },
    [zoom, setZoom]
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      lastPos.current = { x: e.clientX, y: e.clientY };
      setPan(panX + dx, panY + dy);
    },
    [panX, panY, setPan]
  );

  const handleMouseUp = useCallback(() => {
    dragging.current = false;
  }, []);

  if (!page) {
    return <p className="text-sm text-slate-500">No plan pages available.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary text-xs" onClick={() => setZoom(zoom + 0.2)}>
          Zoom in
        </button>
        <button type="button" className="btn-secondary text-xs" onClick={() => setZoom(zoom - 0.2)}>
          Zoom out
        </button>
        <button type="button" className="btn-secondary text-xs" onClick={resetView}>
          Fit to screen
        </button>
        <span className="self-center text-xs text-slate-500">
          {Math.round(zoom * 100)}% · drag to pan
        </span>
      </div>

      <div
        className="overflow-hidden rounded-lg border border-slate-200 bg-white"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: dragging.current ? "grabbing" : "grab" }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${page.widthPx} ${page.heightPx}`}
          width="100%"
          height="480"
          role="img"
          aria-label="Floor plan viewer"
          style={{
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            transformOrigin: "center center",
          }}
        >
          {/* Background grid */}
          <rect width={page.widthPx} height={page.heightPx} fill="#fafafa" />
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e2e8f0" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width={page.widthPx} height={page.heightPx} fill="url(#grid)" />

          {/* Unit boundaries */}
          {visibleLayers.unitBoundaries &&
            result.units.map((unit) => (
              <polygon
                key={unit.id}
                points={polygonToPoints(unit.geometry)}
                fill="none"
                stroke={confidenceColor(unit.confidence, unit.reviewRequired)}
                strokeWidth={selectedId === unit.id ? 4 : 2}
                strokeDasharray={unit.reviewRequired ? "8 4" : undefined}
                onClick={() => selectObject(unit.id)}
                style={{ cursor: "pointer" }}
              />
            ))}

          {/* Spaces */}
          {visibleLayers.rooms &&
            result.spaces
              .filter((s) => s.spaceType === "room")
              .map((space) => (
                <polygon
                  key={space.id}
                  points={polygonToPoints(space.geometry)}
                  fill={SPACE_COLORS.room}
                  fillOpacity={0.6}
                  stroke={confidenceColor(space.confidence, space.reviewRequired)}
                  strokeWidth={selectedId === space.id ? 3 : 1}
                  onClick={() => selectObject(space.id)}
                  style={{ cursor: "pointer" }}
                />
              ))}

          {visibleLayers.commonCorridor &&
            result.spaces
              .filter((s) => s.spaceType === "common_corridor")
              .map((space) => (
                <polygon
                  key={space.id}
                  points={polygonToPoints(space.geometry)}
                  fill={SPACE_COLORS.common_corridor}
                  fillOpacity={0.7}
                  stroke="#3b82f6"
                  strokeWidth={1}
                />
              ))}

          {visibleLayers.balconies &&
            result.spaces
              .filter((s) => s.spaceType === "balcony")
              .map((space) => (
                <polygon
                  key={space.id}
                  points={polygonToPoints(space.geometry)}
                  fill={SPACE_COLORS.balcony}
                  fillOpacity={0.7}
                  stroke="#10b981"
                  strokeWidth={1}
                  onClick={() => selectObject(space.id)}
                  style={{ cursor: "pointer" }}
                />
              ))}

          {/* Openings / entrances */}
          {visibleLayers.unitEntrances &&
            result.openings
              .filter((o) => o.openingType === "unit_entrance")
              .map((opening) => (
                <polygon
                  key={opening.id}
                  points={polygonToPoints(opening.geometry)}
                  fill="#dc2626"
                  fillOpacity={0.8}
                  stroke="#991b1b"
                  strokeWidth={1}
                />
              ))}

          {/* Labels for selected object */}
          {selectedId && (() => {
            const space = result.spaces.find((s) => s.id === selectedId);
            const unit = result.units.find((u) => u.id === selectedId);
            const obj = space ?? unit;
            if (!obj) return null;
            const cx = obj.geometry.reduce((s, p) => s + p[0], 0) / obj.geometry.length;
            const cy = obj.geometry.reduce((s, p) => s + p[1], 0) / obj.geometry.length;
            const area = "areaM2" in obj ? obj.areaM2 : undefined;
            return (
              <text x={cx} y={cy} textAnchor="middle" fontSize="14" fill="#1e293b" fontWeight="bold">
                {selectedId}
                {area != null && ` · ${formatArea(area)}`}
                {" · "}
                {formatConfidence(obj.confidence)}
              </text>
            );
          })()}
        </svg>
      </div>
    </div>
  );
}
