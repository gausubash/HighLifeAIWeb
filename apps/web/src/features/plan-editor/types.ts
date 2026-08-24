import type { BoundingBox, EntityStatus, PlanEntity, PlanEntityType, Point } from "@highlife/shared-types";

export type OverlayLayerId =
  | "calibration"
  | "layout"
  | "walls"
  | "rooms"
  | "doors"
  | "windows"
  | "labels"
  | "dimensions"
  | "review";

export const OVERLAY_LAYERS: { id: OverlayLayerId; label: string; zIndex: number }[] = [
  { id: "layout", label: "Layout", zIndex: 10 },
  { id: "rooms", label: "Rooms", zIndex: 20 },
  { id: "walls", label: "Walls", zIndex: 30 },
  { id: "doors", label: "Doors", zIndex: 40 },
  { id: "windows", label: "Windows", zIndex: 41 },
  { id: "calibration", label: "Calibration", zIndex: 50 },
  { id: "labels", label: "Labels", zIndex: 60 },
  { id: "dimensions", label: "Dimensions", zIndex: 70 },
  { id: "review", label: "Review", zIndex: 80 },
];

export type OverlayTool =
  | "pan"
  | "select"
  | "rect"
  | "polyline"
  | "polygon"
  | "point"
  | "mask";

export type OverlayGeometry =
  | { kind: "rect"; x: number; y: number; width: number; height: number }
  | { kind: "polyline"; points: Point[]; closed?: boolean }
  | { kind: "polygon"; points: Point[] }
  | { kind: "point"; x: number; y: number }
  | { kind: "mask"; points: Point[] };

export interface OverlayEntity {
  id: string;
  type: PlanEntityType;
  layer: OverlayLayerId;
  geometry: OverlayGeometry;
  label: string;
  confidence: number;
  status: EntityStatus;
  source: string;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface LayerSettings {
  visible: boolean;
  opacity: number;
  locked: boolean;
  showRejected: boolean;
}

export const DEFAULT_LAYER_SETTINGS: Record<OverlayLayerId, LayerSettings> = {
  calibration: { visible: true, opacity: 1, locked: false, showRejected: false },
  layout: { visible: true, opacity: 1, locked: false, showRejected: false },
  walls: { visible: true, opacity: 1, locked: false, showRejected: false },
  rooms: { visible: true, opacity: 0.85, locked: false, showRejected: false },
  doors: { visible: true, opacity: 1, locked: false, showRejected: false },
  windows: { visible: true, opacity: 1, locked: false, showRejected: false },
  labels: { visible: true, opacity: 1, locked: false, showRejected: false },
  dimensions: { visible: true, opacity: 1, locked: false, showRejected: false },
  review: { visible: true, opacity: 1, locked: false, showRejected: false },
};

export const ENTITY_LAYER: Record<PlanEntityType, OverlayLayerId> = {
  wall: "walls",
  door: "doors",
  window: "windows",
  room: "rooms",
  unit_boundary: "layout",
  column: "layout",
  stair: "layout",
  fixture: "layout",
  text_label: "labels",
  dimension: "dimensions",
  title_block: "layout",
  legend: "layout",
  north_arrow: "layout",
  scale_region: "calibration",
  notes: "layout",
  other: "review",
  main_floorplan: "layout",
  drawing_border: "layout",
  revision_block: "layout",
};

export const TOOL_DEFAULT_TYPE: Record<Exclude<OverlayTool, "pan" | "select">, PlanEntityType> = {
  rect: "room",
  polyline: "wall",
  polygon: "room",
  point: "text_label",
  mask: "other",
};

export function newEntityId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `ent-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function geometryBBox(geometry: OverlayGeometry): BoundingBox {
  if (geometry.kind === "rect") {
    return {
      x: Math.min(geometry.x, geometry.x + geometry.width),
      y: Math.min(geometry.y, geometry.y + geometry.height),
      width: Math.abs(geometry.width),
      height: Math.abs(geometry.height),
    };
  }
  if (geometry.kind === "point") {
    return { x: geometry.x, y: geometry.y, width: 0, height: 0 };
  }
  const pts = geometry.points;
  if (pts.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = pts[0].x;
  let minY = pts[0].y;
  let maxX = pts[0].x;
  let maxY = pts[0].y;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function overlayToPlanEntity(entity: OverlayEntity): PlanEntity {
  const bbox = geometryBBox(entity.geometry);
  const g = entity.geometry;
  return {
    id: entity.id,
    type: entity.type,
    bboxPx: bbox,
    polygonPx: g.kind === "polygon" ? g.points : g.kind === "mask" ? g.points : undefined,
    polylinePx:
      g.kind === "polyline"
        ? g.points
        : g.kind === "point"
          ? [{ x: g.x, y: g.y }]
          : undefined,
    attributes: {
      ...entity.attributes,
      label: entity.label,
      source: entity.source,
      layer: entity.layer,
      geometryKind: g.kind,
    },
    confidence: entity.confidence,
    status: entity.status,
    evidence: [],
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export function translateGeometry(geometry: OverlayGeometry, dx: number, dy: number): OverlayGeometry {
  if (geometry.kind === "rect") {
    return { ...geometry, x: geometry.x + dx, y: geometry.y + dy };
  }
  if (geometry.kind === "point") {
    return { ...geometry, x: geometry.x + dx, y: geometry.y + dy };
  }
  return {
    ...geometry,
    points: geometry.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
  };
}
