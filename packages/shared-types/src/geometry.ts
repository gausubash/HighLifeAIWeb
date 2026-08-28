/** GeoJSON-style polygon: array of [x, y] pixel coordinates */
export type Polygon = [number, number][];

export interface Space {
  id: string;
  externalId: string;
  spaceType: string;
  unitId?: string | null;
  geometry: Polygon;
  areaM2?: number;
  confidence: number;
  reviewRequired: boolean;
  isCommon?: boolean;
}

export interface Opening {
  id: string;
  externalId: string;
  openingType: string;
  geometry: Polygon;
  fromSpaceId?: string;
  toSpaceId?: string;
  confidence: number;
}

export interface Unit {
  id: string;
  externalId: string;
  geometry: Polygon;
  areaM2?: number;
  entranceIds: string[];
  spaceIds: string[];
  confidence: number;
  reviewRequired: boolean;
}

export interface OcrLine {
  text: string;
  confidence: number;
  bbox?: [number, number][] | null;
}

export interface PageOcrMeta {
  sheetType?: string;
  title?: string | null;
  scaleText?: string | null;
  paperSize?: string | null;
  north?: string | null;
  levelName?: string | null;
  unitIds?: string[];
  warnings?: string[];
  provider?: string;
  confidence?: number;
  ocrLineCount?: number;
  textHint?: string;
  lines?: OcrLine[];
}

export interface PlanPage {
  id: string;
  pageNumber: number;
  imagePath: string;
  widthPx: number;
  heightPx: number;
  isFloorPlan: boolean;
  scaleMPerPixel?: number;
  scaleSource?: string;
  scaleConfidence?: number;
  /** How the source page was drawn: vector CAD, scanned raster, or mixed. */
  graphicsKind?: "vector" | "raster" | "hybrid" | "image" | "unknown";
  graphicsSummary?: string;
  /** Hierarchy: which building/document this page belongs to. */
  documentId?: string | null;
  sourceFileName?: string | null;
  /** OCR on the title block: scale, level, sheet title, unit ids. */
  ocrMeta?: PageOcrMeta | null;
  /** OCR on the detected drawing area: room labels, dimensions, notes on the plan. */
  drawingOcrMeta?: PageOcrMeta | null;
  /** Storey label, e.g. "Level 2". Defaults derived from pageNumber when missing. */
  levelName?: string | null;
  /** Sortable storey index (0-based). Defaults to pageNumber - 1. */
  levelIndex?: number | null;
  floorId?: string | null;
}

/** Layer identifiers for the plan viewer */
export type ViewerLayer =
  | "original"
  | "walls"
  | "doors"
  | "windows"
  | "rooms"
  | "commonCorridor"
  | "privateHalls"
  | "unitBoundaries"
  | "unitEntrances"
  | "balconies"
  | "uncertain"
  | "complianceEvidence";

export const VIEWER_LAYERS: { id: ViewerLayer; label: string }[] = [
  { id: "original", label: "Original plan" },
  { id: "walls", label: "Walls" },
  { id: "doors", label: "Doors" },
  { id: "windows", label: "Windows" },
  { id: "rooms", label: "Rooms" },
  { id: "commonCorridor", label: "Common corridor" },
  { id: "privateHalls", label: "Private halls" },
  { id: "unitBoundaries", label: "Unit boundaries" },
  { id: "unitEntrances", label: "Unit entrances" },
  { id: "balconies", label: "Balconies" },
  { id: "uncertain", label: "Uncertain objects" },
  { id: "complianceEvidence", label: "Compliance evidence" },
];
