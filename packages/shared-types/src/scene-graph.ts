/**
 * Canonical FloorPlanSceneGraph — the only contract consumed by
 * measurement, visualisation, and (later) compliance modules.
 * Do not treat raw model output as the application contract.
 */

export const SCENE_GRAPH_SCHEMA_VERSION = "1.0.0";

export type CoordinateSystem = "original_image_px" | "working_image_px" | "world_mm";

export type CalibrationMethod =
  | "manual_two_point"
  | "dimension_line"
  | "scale_bar"
  | "title_block_scale"
  | "manual_scale_paper"
  | "unknown";

export type EntityStatus = "predicted" | "user_confirmed" | "user_edited" | "rejected";

export type PlanEntityType =
  | "wall"
  | "door"
  | "window"
  | "room"
  | "unit_boundary"
  | "column"
  | "stair"
  | "fixture"
  | "text_label"
  | "dimension"
  | "title_block"
  | "legend"
  | "north_arrow"
  | "scale_region"
  | "notes"
  | "other"
  | "main_floorplan"
  | "drawing_border"
  | "revision_block";

export type RelationshipType =
  | "room_adjacency"
  | "room_door_access"
  | "door_to_wall"
  | "room_window_exterior"
  | "unit_to_room"
  | "room_label_assignment";

export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PolylinePx = Point[];
export type PolygonPx = Point[];

export interface MaskArtifactReference {
  artifactId: string;
  mimeType?: string;
}

export interface CoordinateTransform {
  /** Maps working_image_px → original_image_px: [x', y'] = [sx*x + tx, sy*y + ty] */
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
}

export interface Evidence {
  modelId: string;
  modelVersion: string;
  sourceArtifactId: string;
  confidence: number;
  inferredAt: string;
}

export interface PlanEntity {
  id: string;
  type: PlanEntityType;
  bboxPx?: BoundingBox;
  polygonPx?: PolygonPx;
  polylinePx?: PolylinePx;
  attributes: Record<string, unknown>;
  confidence: number;
  status: EntityStatus;
  evidence: Evidence[];
  createdAt: string;
  updatedAt: string;
}

export interface EntityRelationship {
  id: string;
  type: RelationshipType;
  fromEntityId: string;
  toEntityId: string;
  confidence: number;
  attributes: Record<string, unknown>;
}

export interface Measurement {
  id: string;
  kind:
    | "room_area"
    | "room_perimeter"
    | "opening_width"
    | "wall_thickness"
    | "min_room_width"
    | "distance";
  sourceGeometryIds: string[];
  calibrationId: string;
  valuePx?: number;
  valueMm?: number;
  valueM?: number;
  valueM2?: number;
  unit: string;
  precision: number;
  confidence: number;
  formula?: string;
  estimated: boolean;
}

export interface Calibration {
  id: string;
  method: CalibrationMethod;
  mmPerPixel: number;
  confidence: number;
  sourceText?: string | null;
  sourceGeometryPx?: PolylinePx | null;
  verifiedByUser: boolean;
  active: boolean;
  createdAt: string;
}

export interface FloorPlanSceneGraph {
  schemaVersion: string;
  id: string;
  projectId: string;
  planDocumentId: string;
  pageId: string;
  analysisRunId: string;
  coordinateSystems: CoordinateSystem[];
  workingToOriginal: CoordinateTransform;
  calibration: Calibration | null;
  entities: PlanEntity[];
  relationships: EntityRelationship[];
  measurements: Measurement[];
  createdAt: string;
  updatedAt: string;
}

/** Persistent domain records (API) — UUIDs. */
export interface FpProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanDocument {
  id: string;
  projectId: string;
  filename: string;
  mimeType: string;
  byteSize: number;
  storagePath: string;
  createdAt: string;
  pages?: FpPlanPage[];
}

export interface FpPlanPage {
  id: string;
  planDocumentId: string;
  pageNumber: number;
  widthPx: number;
  heightPx: number;
  dpi: number;
  sourceFilename?: string | null;
  rasterArtifactId?: string | null;
  previewArtifactId?: string | null;
  originalImageUrl?: string | null;
  previewImageUrl?: string | null;
}

export type AnalysisRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "skipped";

export interface AnalysisRun {
  id: string;
  planDocumentId: string;
  pageId: string;
  profile: string;
  status: AnalysisRunStatus;
  warning?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Artifact {
  id: string;
  analysisRunId?: string | null;
  kind: string;
  mimeType: string;
  storagePath: string;
  byteSize: number;
  createdAt: string;
}
