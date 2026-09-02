"use client";

import type { ReactNode } from "react";
import type { Point } from "@highlife/shared-types";
import type { OverlayEntity } from "./types";
import { OVERLAY_LAYERS } from "./types";
import { labelIsHidden, overlayGroupFor, type OverlayEntityGroup } from "./overlayVisibility";
import { classFill, classSwatch, dashForStatus, flattenPoints, hexToRgba, wallClassificationSwatch, type WallThicknessClass } from "./styles";
import {
  COMPASS_KEYPOINT_SWATCH,
  DEFAULT_COMPASS_KEYPOINT_VISIBLE,
  compassKeypointByName,
  headingFromCompassKeypoints,
  pageBearingFromCompassKeypoints,
  isCompassKeypointDrawable,
  resolveCompassKeypoints,
  type CompassKeypoint,
  type CompassKeypointVisible,
} from "@/lib/hierarchy/compassKeypoints";
import { headingFromGeometry } from "@/lib/hierarchy/apartmentAspect";
import { isNorthArrowEntity } from "./compassKeypointAnnotate";

interface OverlayShapesProps {
  entities: OverlayEntity[];
  selectedIds: string[];
  hoverId: string | null;
  scale: number;
  layers: Record<string, { visible: boolean; opacity: number; showRejected: boolean }>;
  groupVisible?: Record<OverlayEntityGroup, boolean>;
  hiddenLabels?: Record<string, boolean>;
  draftPoints?: Point[];
  draftClosed?: boolean;
  draftRect?: { x: number; y: number; width: number; height: number } | null;
  draftRectMode?: "draw" | "marquee";
  activeTile?: { x: number; y: number; width: number; height: number } | null;
  /** Full OCR crop currently being parsed (image pixel coords). */
  ocrRegion?: { x: number; y: number; width: number; height: number } | null;
  /** Tile window inside that crop (image pixel coords). */
  activeOcrTile?: { x: number; y: number; width: number; height: number } | null;
  /** Detection overlays: shaded fill only (crisper when zoomed). Annotate keeps outlines. */
  fillOnlyClosed?: boolean;
  compassKeypointVisible?: CompassKeypointVisible;
  /** When set, wall entities use internal/external colors instead of the default yellow. */
  wallClassById?: ReadonlyMap<string, WallThicknessClass>;
  /** Door entity ids classified as unit main entrances (width threshold). */
  mainDoorIds?: ReadonlySet<string>;
}

function screenPx(px: number, scale: number): number {
  return px / Math.max(scale, 0.04);
}

function svgPoints(pts: number[]): string {
  const out: string[] = [];
  for (let i = 0; i + 1 < pts.length; i += 2) {
    out.push(`${pts[i]},${pts[i + 1]}`);
  }
  return out.join(" ");
}

function dashAttr(dash: number[] | undefined): string | undefined {
  return dash && dash.length ? dash.join(" ") : undefined;
}

function ShapeOf({
  entity,
  selected,
  hovered,
  scale,
  opacity,
  fillOnlyClosed,
  wallClassById,
  mainDoorIds,
}: {
  entity: OverlayEntity;
  selected: boolean;
  hovered: boolean;
  scale: number;
  opacity: number;
  fillOnlyClosed: boolean;
  wallClassById?: ReadonlyMap<string, WallThicknessClass>;
  mainDoorIds?: ReadonlySet<string>;
}) {
  const isWall = entity.layer === "walls" || entity.type === "wall";
  const isMainDoor = entity.type === "door" && mainDoorIds?.has(entity.id);
  const wallClass = isWall ? wallClassById?.get(entity.id) : undefined;
  const colorKey = isMainDoor ? "Main Door" : entity.type === "unit_boundary" ? "Unit" : entity.label;
  const accent = wallClass ? wallClassificationSwatch(wallClass) : classSwatch(colorKey);
  const dash = isWall ? undefined : dashForStatus(entity.status);
  const emphasize = selected || hovered || isMainDoor;
  const closed =
    entity.geometry.kind === "polygon" ||
    entity.geometry.kind === "rect" ||
    entity.geometry.kind === "mask";
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
  const fill = closed
    ? wallClass
      ? hexToRgba(accent, fillAlpha)
      : classFill(colorKey, fillAlpha)
    : undefined;
  const showStroke = !closed || !fillOnlyClosed || emphasize;
  const sw = screenPx(emphasize ? (isMainDoor ? 2.4 : 2) : wallClass === "external" ? 1.65 : 1.25, scale);
  const dasharray = dashAttr(dash);

  const g = entity.geometry;

  if (g.kind === "rect") {
    return (
      <g opacity={opacity}>
        <rect x={g.x} y={g.y} width={g.width} height={g.height} fill={fill ?? "none"} />
        {showStroke ? (
          <rect
            x={g.x}
            y={g.y}
            width={g.width}
            height={g.height}
            fill="none"
            stroke={accent}
            strokeWidth={sw}
            strokeDasharray={dasharray}
            strokeLinecap="butt"
            strokeLinejoin="miter"
          />
        ) : null}
      </g>
    );
  }
  if (g.kind === "point") {
    const r = screenPx(emphasize ? 5 : 4, scale);
    return (
      <g opacity={opacity}>
        <circle cx={g.x} cy={g.y} r={r + screenPx(1.5, scale)} fill="white" />
        <circle cx={g.x} cy={g.y} r={r} fill={accent} />
      </g>
    );
  }
  const closedLine = g.kind === "polygon" || g.kind === "mask" || (g.kind === "polyline" && g.closed);
  const pts = svgPoints(flattenPoints(g));
  const Shape = closedLine ? "polygon" : "polyline";
  return (
    <g opacity={opacity}>
      <Shape
        points={pts}
        fill={closedLine ? (fill ?? "none") : "none"}
        stroke="none"
      />
      {showStroke ? (
        <Shape
          points={pts}
          fill="none"
          stroke={accent}
          strokeWidth={sw}
          strokeDasharray={dasharray}
          strokeLinecap="butt"
          strokeLinejoin="miter"
        />
      ) : null}
    </g>
  );
}

function geometryPoints(entity: OverlayEntity) {
  const g = entity.geometry;
  if (g.kind === "rect") {
    return [
      { x: g.x, y: g.y },
      { x: g.x + g.width, y: g.y },
      { x: g.x + g.width, y: g.y + g.height },
      { x: g.x, y: g.y + g.height },
    ];
  }
  if (g.kind === "point") return [{ x: g.x, y: g.y }];
  return g.points;
}

function arrowHeadPoints(tip: { x: number; y: number }, from: { x: number; y: number }, size: number): string {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const back = { x: tip.x - ux * size, y: tip.y - uy * size };
  const left = { x: back.x + px * size * 0.55, y: back.y + py * size * 0.55 };
  const right = { x: back.x - px * size * 0.55, y: back.y - py * size * 0.55 };
  return `${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`;
}

function CompassKeypointsOf({
  entity,
  scale,
  show,
}: {
  entity: OverlayEntity;
  scale: number;
  show: CompassKeypointVisible;
}) {
  if (!isNorthArrowEntity(entity)) return null;
  const points = geometryPoints(entity);
  const heading = headingFromGeometry(points, entity.attributes);
  const keypoints = resolveCompassKeypoints(entity.attributes, points, heading);
  const tip = compassKeypointByName(keypoints, "tip");
  const base = compassKeypointByName(keypoints, "base");
  const drawTip = isCompassKeypointDrawable(tip, show.tip);
  const drawBase = isCompassKeypointDrawable(base, show.base);
  if (!drawTip && !drawBase) return null;

  const sw = screenPx(1.5, scale);
  const labelPx = screenPx(10, scale);
  const shaftFrom = drawBase ? base : tip;
  const shaftTo = drawTip ? tip : base;
  const headingDeg = headingFromCompassKeypoints(keypoints) ?? heading;
  const bearing = drawTip && drawBase ? pageBearingFromCompassKeypoints(keypoints) : null;
  const shaft =
    shaftFrom &&
    shaftTo &&
    (drawTip && drawBase) ? (
      <line
        x1={shaftFrom.x}
        y1={shaftFrom.y}
        x2={shaftTo.x}
        y2={shaftTo.y}
        stroke="#0f766e"
        strokeWidth={sw}
        strokeLinecap="round"
        opacity={0.9}
      />
    ) : null;

  return (
    <g>
      {shaft}
      {drawBase ? <CompassPointMark point={base} kind="base" scale={scale} labelPx={labelPx} /> : null}
      {drawTip ? (
        <CompassPointMark
          point={tip}
          kind="tip"
          scale={scale}
          labelPx={labelPx}
          from={base ?? (headingDeg != null ? offsetAlongHeading(tip, headingDeg, -screenPx(12, scale)) : undefined)}
        />
      ) : null}
      {bearing != null && base && tip ? (
        <text
          x={(base.x + tip.x) / 2 + screenPx(8, scale)}
          y={(base.y + tip.y) / 2}
          fill="#0f766e"
          fontSize={labelPx}
          fontWeight={700}
          stroke="white"
          strokeWidth={screenPx(2.5, scale)}
          paintOrder="stroke"
          style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
        >
          {`${bearing.toFixed(0)}°`}
        </text>
      ) : null}
    </g>
  );
}

function offsetAlongHeading(from: { x: number; y: number }, headingDeg: number, dist: number) {
  const rad = (headingDeg * Math.PI) / 180;
  return { x: from.x + Math.cos(rad) * dist, y: from.y + Math.sin(rad) * dist };
}

function CompassPointMark({
  point,
  kind,
  scale,
  labelPx,
  from,
}: {
  point: CompassKeypoint;
  kind: "tip" | "base";
  scale: number;
  labelPx: number;
  from?: { x: number; y: number };
}) {
  const color = COMPASS_KEYPOINT_SWATCH[kind];
  const r = screenPx(kind === "tip" ? 5 : 4, scale);
  const label = kind === "tip" ? "tip" : "base";
  return (
    <g>
      {kind === "tip" && from ? (
        <polygon
          points={arrowHeadPoints(point, from, screenPx(11, scale))}
          fill={color}
          stroke={color}
          strokeWidth={screenPx(1.25, scale)}
        />
      ) : (
        <rect
          x={point.x - r}
          y={point.y - r}
          width={r * 2}
          height={r * 2}
          rx={kind === "base" ? screenPx(1.5, scale) : r}
          fill={color}
          stroke={color}
          strokeWidth={screenPx(1.25, scale)}
        />
      )}
      <text
        x={point.x + r + screenPx(2, scale)}
        y={point.y + labelPx * 0.35}
        fill={color}
        fontSize={labelPx}
        fontWeight={600}
        stroke="white"
        strokeWidth={screenPx(2.5, scale)}
        paintOrder="stroke"
        style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
      >
        {label}
      </text>
    </g>
  );
}

export function OverlayShapes({
  entities,
  selectedIds,
  hoverId,
  scale,
  layers,
  groupVisible,
  hiddenLabels = {},
  draftPoints,
  draftClosed,
  draftRect,
  draftRectMode = "draw",
  activeTile,
  ocrRegion = null,
  activeOcrTile = null,
  fillOnlyClosed = false,
  compassKeypointVisible = DEFAULT_COMPASS_KEYPOINT_VISIBLE,
  wallClassById,
  mainDoorIds,
}: OverlayShapesProps) {
  const selected = new Set(selectedIds);
  const orderedLayers = [...OVERLAY_LAYERS].sort((a, b) => a.zIndex - b.zIndex);

  const visibleEntities = orderedLayers.flatMap((layer) => {
    const settings = layers[layer.id];
    if (!settings?.visible) return [];
    return entities.filter((e) => {
      if (e.layer !== layer.id) return false;
      if (e.status === "rejected" && !settings.showRejected) return false;
      if (labelIsHidden(hiddenLabels, e.label)) return false;
      if (groupVisible && !groupVisible[overlayGroupFor(e)]) return false;
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
          wallClassById={wallClassById}
          mainDoorIds={mainDoorIds}
        />
      ))}
      {visibleEntities.map((entity) =>
        isNorthArrowEntity(entity) ? (
          <CompassKeypointsOf
            key={`${entity.id}-kpts`}
            entity={entity}
            scale={scale}
            show={compassKeypointVisible}
          />
        ) : null,
      )}
      {draftRect && (
        <rect
          x={draftRect.x}
          y={draftRect.y}
          width={draftRect.width}
          height={draftRect.height}
          stroke={draftRectMode === "marquee" ? "#0369a1" : "#2563eb"}
          strokeDasharray={`${screenPx(8, scale)} ${screenPx(4, scale)}`}
          strokeWidth={draftSw}
          fill={draftRectMode === "marquee" ? "rgba(14, 165, 233, 0.12)" : classFill("Bedroom", 0.2)}
        />
      )}
      {activeTile && activeTile.width > 0 && activeTile.height > 0 ? (
        <g>
          <rect
            x={activeTile.x}
            y={activeTile.y}
            width={activeTile.width}
            height={activeTile.height}
            fill="rgba(14, 165, 233, 0.12)"
          />
          <rect
            x={activeTile.x}
            y={activeTile.y}
            width={activeTile.width}
            height={activeTile.height}
            fill="none"
            stroke="#0284c7"
            strokeDasharray={`${screenPx(10, scale)} ${screenPx(6, scale)}`}
            strokeWidth={screenPx(2, scale)}
          />
        </g>
      ) : null}
      {ocrRegion && ocrRegion.width > 0 && ocrRegion.height > 0 ? (
        <g>
          <rect
            x={ocrRegion.x}
            y={ocrRegion.y}
            width={ocrRegion.width}
            height={ocrRegion.height}
            fill="rgba(13, 148, 136, 0.08)"
          />
          <rect
            x={ocrRegion.x}
            y={ocrRegion.y}
            width={ocrRegion.width}
            height={ocrRegion.height}
            fill="none"
            stroke="#0d9488"
            strokeDasharray={`${screenPx(8, scale)} ${screenPx(6, scale)}`}
            strokeWidth={screenPx(1.5, scale)}
          />
        </g>
      ) : null}
      {activeOcrTile && activeOcrTile.width > 0 && activeOcrTile.height > 0 ? (
        <g>
          <rect
            x={activeOcrTile.x}
            y={activeOcrTile.y}
            width={activeOcrTile.width}
            height={activeOcrTile.height}
            fill="rgba(13, 148, 136, 0.2)"
          />
          <rect
            x={activeOcrTile.x}
            y={activeOcrTile.y}
            width={activeOcrTile.width}
            height={activeOcrTile.height}
            fill="none"
            stroke="#0f766e"
            strokeDasharray={`${screenPx(10, scale)} ${screenPx(5, scale)}`}
            strokeWidth={screenPx(2.5, scale)}
          />
        </g>
      ) : null}
      {draftPoints && draftPoints.length > 0 &&
        (draftClosed ? (
          <polygon
            points={draftPoints.map((p) => `${p.x},${p.y}`).join(" ")}
            stroke="#2563eb"
            strokeDasharray={`${screenPx(8, scale)} ${screenPx(4, scale)}`}
            strokeWidth={draftSw}
            fill={classFill("Bedroom", 0.2)}
          />
        ) : (
          <polyline
            points={draftPoints.map((p) => `${p.x},${p.y}`).join(" ")}
            stroke="#2563eb"
            strokeDasharray={`${screenPx(8, scale)} ${screenPx(4, scale)}`}
            strokeWidth={draftSw}
            fill="none"
          />
        ))}
    </>
  );
}

interface OverlaySvgLayerProps {
  imageWidth: number;
  imageHeight: number;
  children: ReactNode;
}

/** Vector overlay in page pixels. Parent must be the zoomed stage size — do not CSS-scale this SVG. */
export function OverlaySvgLayer({ imageWidth, imageHeight, children }: OverlaySvgLayerProps) {
  if (imageWidth < 1 || imageHeight < 1) return null;
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${imageWidth} ${imageHeight}`}
      preserveAspectRatio="none"
      overflow="visible"
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      {children}
    </svg>
  );
}
