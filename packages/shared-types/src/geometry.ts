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
