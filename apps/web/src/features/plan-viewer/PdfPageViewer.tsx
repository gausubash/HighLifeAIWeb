"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointPx } from "@/lib/scale/parseScale";
import { pixelDistance } from "@/lib/scale/parseScale";
import { clientToImagePixels, loupeImageStyle } from "./imageCoords";
import { useViewerStore } from "./useViewerStore";
import { clampPanToViewport, clampZoom } from "./viewBounds";

const OverlayHost = dynamic(
  () => import("@/features/plan-editor/OverlayHost").then((m) => m.OverlayHost),
  { ssr: false },
);

const LOUPE_SIZE = 160;
const LOUPE_MAGNIFY = 4;
const LOUPE_GAP = 20;

interface PdfPageViewerProps {
  imagePath: string;
  widthPx: number;
  heightPx: number;
  /** Click-to-pick modes share loupe + two-point UI. */
  toolMode?: "none" | "calibrate" | "measure";
  measurePoints?: PointPx[];
  /** Optional label drawn at the midpoint (e.g. "5.000 m"). */
  measureLabel?: string | null;
  onMeasurePoint?: (point: PointPx) => void;
  enableOverlay?: boolean;
}

type LoupeState = {
  left: number;
  top: number;
  cursorX: number;
  cursorY: number;
  imgLeft: number;
  imgTop: number;
  imgWidth: number;
  imgHeight: number;
};

export function PdfPageViewer({
  imagePath,
  widthPx,
  heightPx,
  toolMode = "none",
  measurePoints = [],
  measureLabel = null,
  onMeasurePoint,
  enableOverlay = true,
}: PdfPageViewerProps) {
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const { zoom, panX, panY, setZoom, setPan, resetView } = useViewerStore();
  const [loupe, setLoupe] = useState<LoupeState | null>(null);
  /** Uniform scale so the page fits the viewport without stretching. */
  const [fitScale, setFitScale] = useState(1);
  const picking = toolMode !== "none";

  useEffect(() => {
    if (!picking) setLoupe(null);
  }, [picking]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const updateFit = () => {
      const pad = 16;
      const availW = Math.max(1, el.clientWidth - pad);
      const availH = Math.max(1, el.clientHeight - pad);
      setFitScale(Math.min(1, availW / widthPx, availH / heightPx));
    };

    updateFit();
    const ro = new ResizeObserver(updateFit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [widthPx, heightPx]);

  const getDisplayRect = useCallback(() => {
    const img = imgRef.current;
    if (!img) return null;
    const r = img.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }, []);

  const stageW = widthPx * fitScale;
  const stageH = heightPx * fitScale;

  const applyPan = useCallback(
    (nextX: number, nextY: number, nextZoom = zoom) => {
      const el = viewportRef.current;
      if (!el) {
        setPan(nextX, nextY);
        return;
      }
      const clamped = clampPanToViewport(
        nextX,
        nextY,
        nextZoom,
        stageW,
        stageH,
        el.clientWidth,
        el.clientHeight,
      );
      setPan(clamped.x, clamped.y);
    },
    [zoom, stageW, stageH, setPan],
  );

  const applyZoom = useCallback(
    (nextZoom: number) => {
      const z = clampZoom(nextZoom);
      setZoom(z);
      applyPan(panX, panY, z);
    },
    [setZoom, applyPan, panX, panY],
  );

  // Re-clamp when the fit size or viewport changes (e.g. resize).
  useEffect(() => {
    applyPan(panX, panY, zoom);
    // Intentionally only when stage/viewport geometry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- pan/zoom applied via applyPan
  }, [stageW, stageH, fitScale]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      applyZoom(zoom + delta);
    },
    [zoom, applyZoom],
  );

  const updateLoupe = useCallback(
    (clientX: number, clientY: number) => {
      if (!picking) {
        setLoupe(null);
        return;
      }
      const display = getDisplayRect();
      const viewport = viewportRef.current;
      if (!display || !viewport) {
        setLoupe(null);
        return;
      }

      const pt = clientToImagePixels(clientX, clientY, display, widthPx, heightPx);
      if (!pt) {
        setLoupe(null);
        return;
      }

      const viewRect = viewport.getBoundingClientRect();
      const cursorX = clientX - viewRect.left;
      const cursorY = clientY - viewRect.top;

      let left = cursorX + LOUPE_GAP;
      let top = cursorY - LOUPE_SIZE - LOUPE_GAP;
      if (left + LOUPE_SIZE > viewRect.width - 8) left = cursorX - LOUPE_SIZE - LOUPE_GAP;
      if (top < 8) top = cursorY + LOUPE_GAP;
      left = Math.max(8, Math.min(left, viewRect.width - LOUPE_SIZE - 8));
      top = Math.max(8, Math.min(top, viewRect.height - LOUPE_SIZE - 8));

      const placed = loupeImageStyle(
        pt.x,
        pt.y,
        widthPx,
        heightPx,
        display.width,
        display.height,
        LOUPE_SIZE,
        LOUPE_MAGNIFY,
      );

      setLoupe({
        left,
        top,
        cursorX,
        cursorY,
        imgLeft: placed.left,
        imgTop: placed.top,
        imgWidth: placed.width,
        imgHeight: placed.height,
      });
    },
    [picking, getDisplayRect, widthPx, heightPx],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;

      if (picking) {
        const display = getDisplayRect();
        if (!display) return;
        const pt = clientToImagePixels(e.clientX, e.clientY, display, widthPx, heightPx);
        if (pt) onMeasurePoint?.(pt);
        return;
      }

      dragging.current = true;
      lastPos.current = { x: e.clientX, y: e.clientY };
    },
    [picking, getDisplayRect, widthPx, heightPx, onMeasurePoint],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (picking) {
        updateLoupe(e.clientX, e.clientY);
        return;
      }
      if (!dragging.current) return;
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      lastPos.current = { x: e.clientX, y: e.clientY };
      applyPan(panX + dx, panY + dy);
    },
    [picking, updateLoupe, panX, panY, applyPan],
  );

  const handleMouseUp = useCallback(() => {
    dragging.current = false;
  }, []);

  const startBackgroundPan = useCallback((clientX: number, clientY: number) => {
    dragging.current = true;
    lastPos.current = { x: clientX, y: clientY };
  }, []);

  const handleMouseLeave = useCallback(() => {
    dragging.current = false;
    setLoupe(null);
  }, []);

  const p1 = measurePoints[0];
  const p2 = measurePoints[1];
  const distPx = p1 && p2 ? pixelDistance(p1, p2) : null;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {picking && (
        <div className="pointer-events-none absolute left-3 top-3 z-30">
          {toolMode === "calibrate" && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900 shadow-sm">
              Calibrate
              {measurePoints.length === 0 && " · point 1"}
              {measurePoints.length === 1 && " · point 2"}
              {measurePoints.length >= 2 && distPx != null && ` · ${distPx.toFixed(1)} px`}
            </span>
          )}
          {toolMode === "measure" && (
            <span className="rounded bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-900 shadow-sm">
              Measure
              {measurePoints.length === 0 && " · point 1"}
              {measurePoints.length === 1 && " · point 2"}
              {measurePoints.length >= 2 && measureLabel && ` · ${measureLabel}`}
            </span>
          )}
        </div>
      )}

      <div
        ref={viewportRef}
        className="relative min-h-0 flex-1 overflow-hidden bg-slate-200"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: picking ? "none" : dragging.current ? "grabbing" : "grab" }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="relative shadow-md"
            style={{
              width: stageW,
              height: stageH,
              transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
              transformOrigin: "center center",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={imagePath}
              alt="Uploaded floor plan page"
              width={widthPx}
              height={heightPx}
              className="block h-full w-full max-w-none"
              draggable={false}
            />
            {enableOverlay && (
              <OverlayHost
                imageWidth={widthPx}
                imageHeight={heightPx}
                displayWidth={stageW}
                displayHeight={stageH}
                zoom={zoom}
                passThrough={picking}
                onBackgroundPanStart={startBackgroundPan}
                onPanBy={(dx, dy) => applyPan(panX + dx, panY + dy)}
              />
            )}
            {(p1 || p2) && (
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox={`0 0 ${widthPx} ${heightPx}`}
                preserveAspectRatio="none"
              >
                {p1 && p2 && (
                  <line
                    x1={p1.x}
                    y1={p1.y}
                    x2={p2.x}
                    y2={p2.y}
                    stroke={toolMode === "measure" ? "#0369a1" : "#0f766e"}
                    strokeWidth={Math.max(2, widthPx / 800)}
                    strokeDasharray="8 4"
                  />
                )}
                {p1 && p2 && measureLabel && (
                  <text
                    x={(p1.x + p2.x) / 2}
                    y={(p1.y + p2.y) / 2 - Math.max(12, widthPx / 120)}
                    textAnchor="middle"
                    fill={toolMode === "measure" ? "#0c4a6e" : "#134e4a"}
                    stroke="white"
                    strokeWidth={Math.max(3, widthPx / 400)}
                    paintOrder="stroke"
                    fontSize={Math.max(14, widthPx / 70)}
                    fontFamily="ui-sans-serif, system-ui, sans-serif"
                    fontWeight={600}
                  >
                    {measureLabel}
                  </text>
                )}
                {measurePoints.map((pt, i) => {
                  const arm = Math.max(14, widthPx / 90);
                  const gap = Math.max(3, widthPx / 500);
                  const stroke = toolMode === "measure" ? "#0369a1" : "#0f766e";
                  const sw = Math.max(1.5, widthPx / 900);
                  return (
                    <g key={i}>
                      {/* White halo for contrast on dark lines */}
                      <line
                        x1={pt.x - arm}
                        y1={pt.y}
                        x2={pt.x - gap}
                        y2={pt.y}
                        stroke="white"
                        strokeWidth={sw + 2}
                        strokeLinecap="square"
                      />
                      <line
                        x1={pt.x + gap}
                        y1={pt.y}
                        x2={pt.x + arm}
                        y2={pt.y}
                        stroke="white"
                        strokeWidth={sw + 2}
                        strokeLinecap="square"
                      />
                      <line
                        x1={pt.x}
                        y1={pt.y - arm}
                        x2={pt.x}
                        y2={pt.y - gap}
                        stroke="white"
                        strokeWidth={sw + 2}
                        strokeLinecap="square"
                      />
                      <line
                        x1={pt.x}
                        y1={pt.y + gap}
                        x2={pt.x}
                        y2={pt.y + arm}
                        stroke="white"
                        strokeWidth={sw + 2}
                        strokeLinecap="square"
                      />
                      <line
                        x1={pt.x - arm}
                        y1={pt.y}
                        x2={pt.x - gap}
                        y2={pt.y}
                        stroke={stroke}
                        strokeWidth={sw}
                        strokeLinecap="square"
                      />
                      <line
                        x1={pt.x + gap}
                        y1={pt.y}
                        x2={pt.x + arm}
                        y2={pt.y}
                        stroke={stroke}
                        strokeWidth={sw}
                        strokeLinecap="square"
                      />
                      <line
                        x1={pt.x}
                        y1={pt.y - arm}
                        x2={pt.x}
                        y2={pt.y - gap}
                        stroke={stroke}
                        strokeWidth={sw}
                        strokeLinecap="square"
                      />
                      <line
                        x1={pt.x}
                        y1={pt.y + gap}
                        x2={pt.x}
                        y2={pt.y + arm}
                        stroke={stroke}
                        strokeWidth={sw}
                        strokeLinecap="square"
                      />
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
        </div>

        {picking && loupe && (
          <>
            {/* Open crosshair under the cursor (exact pick point) */}
            <div
              className="pointer-events-none absolute z-10"
              style={{
                left: loupe.cursorX,
                top: loupe.cursorY,
                width: 28,
                height: 28,
                transform: "translate(-50%, -50%)",
              }}
            >
              <div className="absolute left-0 right-[58%] top-1/2 h-0.5 -translate-y-1/2 bg-white shadow-sm" />
              <div className="absolute left-[58%] right-0 top-1/2 h-0.5 -translate-y-1/2 bg-white shadow-sm" />
              <div className="absolute top-0 bottom-[58%] left-1/2 w-0.5 -translate-x-1/2 bg-white shadow-sm" />
              <div className="absolute top-[58%] bottom-0 left-1/2 w-0.5 -translate-x-1/2 bg-white shadow-sm" />
              <div className="absolute left-0 right-[58%] top-1/2 h-px -translate-y-1/2 bg-teal-800" />
              <div className="absolute left-[58%] right-0 top-1/2 h-px -translate-y-1/2 bg-teal-800" />
              <div className="absolute top-0 bottom-[58%] left-1/2 w-px -translate-x-1/2 bg-teal-800" />
              <div className="absolute top-[58%] bottom-0 left-1/2 w-px -translate-x-1/2 bg-teal-800" />
            </div>
            <div
              className="pointer-events-none absolute z-20 overflow-hidden rounded-full border-[3px] border-white bg-slate-800 shadow-[0_8px_28px_rgba(15,23,42,0.45)] ring-1 ring-teal-800/40"
              style={{
                width: LOUPE_SIZE,
                height: LOUPE_SIZE,
                left: loupe.left,
                top: loupe.top,
              }}
              aria-hidden
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePath}
                alt=""
                draggable={false}
                className="absolute max-w-none"
                style={{
                  width: loupe.imgWidth,
                  height: loupe.imgHeight,
                  left: loupe.imgLeft,
                  top: loupe.imgTop,
                }}
              />
              {/* Open crosshair in loupe centre — gap so the pixel stays visible */}
              <div className="absolute inset-0">
                <div className="absolute left-0 right-[52%] top-1/2 h-0.5 -translate-y-1/2 bg-white/90" />
                <div className="absolute left-[52%] right-0 top-1/2 h-0.5 -translate-y-1/2 bg-white/90" />
                <div className="absolute top-0 bottom-[52%] left-1/2 w-0.5 -translate-x-1/2 bg-white/90" />
                <div className="absolute top-[52%] bottom-0 left-1/2 w-0.5 -translate-x-1/2 bg-white/90" />
                <div className="absolute left-0 right-[52%] top-1/2 h-px -translate-y-1/2 bg-teal-700" />
                <div className="absolute left-[52%] right-0 top-1/2 h-px -translate-y-1/2 bg-teal-700" />
                <div className="absolute top-0 bottom-[52%] left-1/2 w-px -translate-x-1/2 bg-teal-700" />
                <div className="absolute top-[52%] bottom-0 left-1/2 w-px -translate-x-1/2 bg-teal-700" />
              </div>
            </div>
          </>
        )}
      </div>

      <div
        className="absolute bottom-3 left-3 z-30 flex items-center overflow-hidden rounded-md border border-slate-200 bg-white/95 shadow-sm"
        onMouseDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="h-7 w-7 text-sm font-medium text-slate-700 hover:bg-slate-100"
          title="Zoom out"
          onClick={() => applyZoom(zoom - 0.2)}
        >
          −
        </button>
        <span className="min-w-[2.75rem] border-x border-slate-200 px-1.5 text-center text-[11px] tabular-nums text-slate-600">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          className="h-7 w-7 text-sm font-medium text-slate-700 hover:bg-slate-100"
          title="Zoom in"
          onClick={() => applyZoom(zoom + 0.2)}
        >
          +
        </button>
        <button
          type="button"
          className="h-7 border-l border-slate-200 px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
          title="Fit page"
          onClick={resetView}
        >
          Fit
        </button>
      </div>
    </div>
  );
}
