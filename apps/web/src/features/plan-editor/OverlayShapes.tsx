"use client";

import type { ReactNode } from "react";
import { Circle, Layer, Line, Rect, Stage } from "react-konva";
import type { Point } from "@highlife/shared-types";
import type { OverlayEntity } from "./types";
import { OVERLAY_LAYERS } from "./types";
import { classFill, classSwatch, dashForStatus, flattenPoints } from "./styles";

interface OverlayShapesProps {
  entities: OverlayEntity[];
  selectedIds: string[];
  hoverId: string | null;
  scale: number;
  layers: Record<string, { visible: boolean; opacity: number; showRejected: boolean }>;
  hiddenLabels?: Record<string, boolean>;
  draftPoints?: Point[];
  draftClosed?: boolean;
  draftRect?: { x: number; y: number; width: number; height: number } | null;
  activeTile?: { x: number; y: number; width: number; height: number } | null;
  /** Full OCR crop currently being parsed (image pixel coords). */
  ocrRegion?: { x: number; y: number; width: number; height: number } | null;
  /** Tile window inside that crop (image pixel coords). */
  activeOcrTile?: { x: number; y: number; width: number; height: number } | null;
  /** Detection overlays: shaded fill only (crisper when zoomed). Annotate keeps outlines. */
  fillOnlyClosed?: boolean;
}

function screenPx(px: number, scale: number): number {
  return px / Math.max(scale, 0.04);
}

function ShapeOf({
  entity,
  selected,
  hovered,
  scale,
  opacity,
  fillOnlyClosed,
}: {
  entity: OverlayEntity;
  selected: boolean;
  hovered: boolean;
  scale: number;
  opacity: number;
  fillOnlyClosed: boolean;
}) {
  const accent = classSwatch(entity.label);
  const isWall = entity.layer === "walls" || entity.type === "wall";
  const dash = isWall ? undefined : dashForStatus(entity.status);
  const emphasize = selected || hovered;
  const closed =
    entity.geometry.kind === "polygon" ||
    entity.geometry.kind === "rect" ||
    entity.geometry.kind === "mask";
  // Stronger fill when outlines are off so walls stay readable.
  const fillAlpha =
    fillOnlyClosed && closed
      ? emphasize
        ? 0.55
        : isWall
          ? 0.48
          : 0.4
      : emphasize
        ? 0.42
        : 0.34;
  const fill = closed ? classFill(entity.label, fillAlpha) : undefined;
  const showStroke = !closed || !fillOnlyClosed || emphasize;
  const sw = screenPx(emphasize ? 2 : 1.25, scale);

  const strokeCommon = {
    stroke: accent,
    strokeWidth: sw,
    dash,
    opacity,
    lineCap: "butt" as const,
    lineJoin: "miter" as const,
    listening: false,
    perfectDrawEnabled: false,
    shadowForStrokeEnabled: false,
    hitStrokeWidth: 0,
  };

  const g = entity.geometry;

  if (g.kind === "rect") {
    return (
      <>
        <Rect
          x={g.x}
          y={g.y}
          width={g.width}
          height={g.height}
          fill={fill}
          listening={false}
          perfectDrawEnabled={false}
          opacity={opacity}
        />
        {showStroke ? (
          <Rect
            x={g.x}
            y={g.y}
            width={g.width}
            height={g.height}
            fillEnabled={false}
            {...strokeCommon}
          />
        ) : null}
      </>
    );
  }
  if (g.kind === "point") {
    const r = screenPx(emphasize ? 5 : 4, scale);
    return (
      <>
        <Circle
          x={g.x}
          y={g.y}
          radius={r + screenPx(1.5, scale)}
          fill="white"
          opacity={opacity}
          listening={false}
        />
        <Circle x={g.x} y={g.y} radius={r} fill={accent} opacity={opacity} listening={false} />
      </>
    );
  }
  const closedLine = g.kind === "polygon" || g.kind === "mask" || (g.kind === "polyline" && g.closed);
  const pts = flattenPoints(g);
  return (
    <>
      <Line
        points={pts}
        closed={closedLine}
        fill={closedLine ? fill : undefined}
        listening={false}
        perfectDrawEnabled={false}
        opacity={opacity}
        fillEnabled={Boolean(closedLine && fill)}
      />
      {showStroke ? (
        <Line points={pts} closed={closedLine} fillEnabled={false} {...strokeCommon} />
      ) : null}
    </>
  );
}

export function OverlayShapes({
  entities,
  selectedIds,
  hoverId,
  scale,
  layers,
  hiddenLabels = {},
  draftPoints,
  draftClosed,
  draftRect,
  activeTile,
  ocrRegion = null,
  activeOcrTile = null,
  fillOnlyClosed = false,
}: OverlayShapesProps) {
  const selected = new Set(selectedIds);
  const orderedLayers = [...OVERLAY_LAYERS].sort((a, b) => a.zIndex - b.zIndex);

  const visibleEntities = orderedLayers.flatMap((layer) => {
    const settings = layers[layer.id];
    if (!settings?.visible) return [];
    return entities.filter((e) => {
      if (e.layer !== layer.id) return false;
      if (e.status === "rejected" && !settings.showRejected) return false;
      if (hiddenLabels[e.label]) return false;
      return true;
    });
  });

  const draftSw = screenPx(1.75, scale);

  return (
    <>
      {visibleEntities.map((entity) => (
        <ShapeOf
          key={entity.id}
          entity={entity}
          selected={selected.has(entity.id)}
          hovered={hoverId === entity.id}
          scale={scale}
          opacity={layers[entity.layer]?.opacity ?? 1}
          fillOnlyClosed={fillOnlyClosed}
        />
      ))}
      {draftRect && (
        <Rect
          {...draftRect}
          stroke="#2563eb"
          dash={[screenPx(8, scale), screenPx(4, scale)]}
          strokeWidth={draftSw}
          fill={classFill("Bedroom", 0.2)}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
      {activeTile && activeTile.width > 0 && activeTile.height > 0 ? (
        <>
          <Rect
            x={activeTile.x}
            y={activeTile.y}
            width={activeTile.width}
            height={activeTile.height}
            fill="rgba(14, 165, 233, 0.12)"
            listening={false}
            perfectDrawEnabled={false}
          />
          <Rect
            x={activeTile.x}
            y={activeTile.y}
            width={activeTile.width}
            height={activeTile.height}
            stroke="#0284c7"
            dash={[screenPx(10, scale), screenPx(6, scale)]}
            strokeWidth={screenPx(2, scale)}
            fillEnabled={false}
            listening={false}
            perfectDrawEnabled={false}
          />
        </>
      ) : null}
      {ocrRegion && ocrRegion.width > 0 && ocrRegion.height > 0 ? (
        <>
          <Rect
            x={ocrRegion.x}
            y={ocrRegion.y}
            width={ocrRegion.width}
            height={ocrRegion.height}
            fill="rgba(13, 148, 136, 0.08)"
            listening={false}
            perfectDrawEnabled={false}
          />
          <Rect
            x={ocrRegion.x}
            y={ocrRegion.y}
            width={ocrRegion.width}
            height={ocrRegion.height}
            stroke="#0d9488"
            dash={[screenPx(8, scale), screenPx(6, scale)]}
            strokeWidth={screenPx(1.5, scale)}
            fillEnabled={false}
            listening={false}
            perfectDrawEnabled={false}
          />
        </>
      ) : null}
      {activeOcrTile && activeOcrTile.width > 0 && activeOcrTile.height > 0 ? (
        <>
          <Rect
            x={activeOcrTile.x}
            y={activeOcrTile.y}
            width={activeOcrTile.width}
            height={activeOcrTile.height}
            fill="rgba(13, 148, 136, 0.2)"
            listening={false}
            perfectDrawEnabled={false}
          />
          <Rect
            x={activeOcrTile.x}
            y={activeOcrTile.y}
            width={activeOcrTile.width}
            height={activeOcrTile.height}
            stroke="#0f766e"
            dash={[screenPx(10, scale), screenPx(5, scale)]}
            strokeWidth={screenPx(2.5, scale)}
            fillEnabled={false}
            listening={false}
            perfectDrawEnabled={false}
          />
        </>
      ) : null}
      {draftPoints && draftPoints.length > 0 && (
        <Line
          points={draftPoints.flatMap((p) => [p.x, p.y])}
          stroke="#2563eb"
          dash={[screenPx(8, scale), screenPx(4, scale)]}
          strokeWidth={draftSw}
          closed={Boolean(draftClosed)}
          fill={draftClosed ? classFill("Bedroom", 0.2) : undefined}
          listening={false}
          perfectDrawEnabled={false}
        />
      )}
    </>
  );
}

interface OverlayKonvaStageProps {
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
  zoom?: number;
  children: ReactNode;
}

/** Konva canvas in display pixels; children drawn in original image pixels via scale. */
export function OverlayKonvaStage({
  width,
  height,
  imageWidth,
  imageHeight,
  zoom = 1,
  children,
}: OverlayKonvaStageProps) {
  const sx = imageWidth > 0 ? width / imageWidth : 1;
  const sy = imageHeight > 0 ? height / imageHeight : 1;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  // Parent applies CSS zoom — keep backing-store sharp (was capped at 4 → soft when zoomed).
  const pixelRatio = Math.min(8, Math.max(1, dpr * Math.max(1, zoom)));
  return (
    <Stage
      width={Math.max(1, Math.round(width))}
      height={Math.max(1, Math.round(height))}
      listening={false}
      pixelRatio={pixelRatio}
    >
      <Layer scaleX={sx} scaleY={sy} listening={false} imageSmoothingEnabled={false}>
        {children}
      </Layer>
    </Stage>
  );
}
