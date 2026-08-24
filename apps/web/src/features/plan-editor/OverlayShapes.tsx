"use client";

import type { ReactNode } from "react";
import { Layer, Line, Rect, Stage, Circle, Text } from "react-konva";
import type { Point } from "@highlife/shared-types";
import type { OverlayEntity, OverlayGeometry } from "./types";
import { OVERLAY_LAYERS } from "./types";
import { dashForStatus, flattenPoints, LAYER_STROKE, roomFill } from "./styles";
import { entityAreaHint } from "./geometry";

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
}

function strokeWidth(scale: number): number {
  return Math.max(1.25 / scale, 0.4);
}

function ShapeOf({
  entity,
  selected,
  hovered,
  scale,
  opacity,
}: {
  entity: OverlayEntity;
  selected: boolean;
  hovered: boolean;
  scale: number;
  opacity: number;
}) {
  const isWall = entity.layer === "walls" || entity.type === "wall";
  const stroke = isWall ? "rgba(250, 204, 21, 0.8)" : LAYER_STROKE[entity.layer];
  const dash = isWall ? undefined : dashForStatus(entity.status);
  const sw =
    (isWall ? Math.max(2.8 / scale, 1.5) : strokeWidth(scale)) * (selected || hovered ? 1.8 : 1);
  const g = entity.geometry;
  const fill =
    isWall
      ? "rgba(250, 204, 21, 0.18)"
      : g.kind === "polygon" || g.kind === "rect" || g.kind === "mask"
        ? entity.layer === "rooms" || entity.layer === "layout"
          ? roomFill(entity.attributes.roomType ?? entity.label)
          : g.kind === "mask"
            ? "rgba(219, 39, 119, 0.12)"
            : "rgba(100, 116, 139, 0.08)"
        : undefined;

  const common = {
    stroke,
    strokeWidth: sw,
    dash,
    opacity,
    listening: false,
    perfectDrawEnabled: false,
  };

  if (g.kind === "rect") {
    return (
      <Rect
        x={g.x}
        y={g.y}
        width={g.width}
        height={g.height}
        fill={fill}
        {...common}
      />
    );
  }
  if (g.kind === "point") {
    return (
      <Circle x={g.x} y={g.y} radius={Math.max(4 / scale, 2)} fill={stroke} {...common} />
    );
  }
  const closed = g.kind === "polygon" || g.kind === "mask" || (g.kind === "polyline" && g.closed);
  return (
    <Line
      points={flattenPoints(g)}
      closed={closed}
      fill={closed ? fill : undefined}
      lineCap="round"
      lineJoin="round"
      {...common}
    />
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

  const hoverEntity = hoverId ? visibleEntities.find((e) => e.id === hoverId) : null;

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
        />
      ))}
      {visibleEntities.map((entity) => {
        const pos = centroid(entity.geometry);
        const selectedEntity = selected.has(entity.id);
        return (
          <Text
            key={`${entity.id}-label`}
            x={pos.x}
            y={pos.y}
            text={`${entity.label} ${Math.round(entity.confidence * 100)}%`}
            fontSize={Math.max(11 / scale, selectedEntity ? 12 : 10)}
            fill="#0f172a"
            offsetY={8}
            listening={false}
          />
        );
      })}
      {hoverEntity && (
        <Text
          x={tooltipPos(hoverEntity.geometry).x}
          y={tooltipPos(hoverEntity.geometry).y}
          text={tooltipText(hoverEntity)}
          fontSize={Math.max(12 / scale, 10)}
          fill="#0f172a"
          listening={false}
        />
      )}
      {draftRect && (
        <Rect
          {...draftRect}
          stroke="#2563eb"
          dash={[8 / scale, 4 / scale]}
          strokeWidth={strokeWidth(scale)}
          fill="rgba(37,99,235,0.08)"
          listening={false}
        />
      )}
      {draftPoints && draftPoints.length > 0 && (
        <Line
          points={draftPoints.flatMap((p) => [p.x, p.y])}
          stroke="#2563eb"
          dash={[8 / scale, 4 / scale]}
          strokeWidth={strokeWidth(scale)}
          closed={Boolean(draftClosed)}
          fill={draftClosed ? "rgba(37,99,235,0.08)" : undefined}
          listening={false}
        />
      )}
    </>
  );
}

function centroid(g: OverlayGeometry): Point {
  if (g.kind === "point") return { x: g.x, y: g.y };
  if (g.kind === "rect") return { x: g.x + g.width / 2, y: g.y + g.height / 2 };
  if (g.points.length === 0) return { x: 0, y: 0 };
  const x = g.points.reduce((sum, p) => sum + p.x, 0) / g.points.length;
  const y = g.points.reduce((sum, p) => sum + p.y, 0) / g.points.length;
  return { x, y };
}

function tooltipPos(g: OverlayGeometry): Point {
  if (g.kind === "point") return { x: g.x + 8, y: g.y - 8 };
  if (g.kind === "rect") return { x: g.x, y: g.y - 4 };
  const p = g.points[0];
  return { x: (p?.x ?? 0) + 8, y: (p?.y ?? 0) - 8 };
}

function tooltipText(entity: OverlayEntity): string {
  const measure = entityAreaHint(entity);
  const bits = [
    entity.id.slice(0, 8),
    entity.type,
    `${Math.round(entity.confidence * 100)}%`,
    entity.status,
    measure,
  ].filter(Boolean);
  return bits.join(" · ");
}

interface OverlayKonvaStageProps {
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
  children: ReactNode;
}

/** Konva canvas in display pixels; children drawn in original image pixels via scale. */
export function OverlayKonvaStage({
  width,
  height,
  imageWidth,
  imageHeight,
  children,
}: OverlayKonvaStageProps) {
  const sx = imageWidth > 0 ? width / imageWidth : 1;
  const sy = imageHeight > 0 ? height / imageHeight : 1;
  return (
    <Stage width={Math.max(1, Math.round(width))} height={Math.max(1, Math.round(height))} listening={false}>
      <Layer scaleX={sx} scaleY={sy} listening={false}>
        {children}
      </Layer>
    </Stage>
  );
}
