/**
 * Building → Floor → Unit → Room hierarchy extracted from plan detections.
 * One AnalysisResult may span multiple PDFs/pages; floors group pages.
 */

import type { Opening, Space, Unit } from "./geometry";

export type HierarchyObjectKind = "door" | "window" | "fixture" | "stair" | "other";

export interface HierarchyObject {
  id: string;
  kind: HierarchyObjectKind;
  label: string;
  parentRoomId?: string | null;
  parentUnitId?: string | null;
  confidence: number;
}

export interface HierarchyRoom {
  id: string;
  label: string;
  roomType: string;
  unitId: string | null;
  isCommon: boolean;
  areaM2?: number | null;
  confidence: number;
  objectIds: string[];
}

export interface HierarchyUnit {
  id: string;
  label: string;
  areaM2?: number | null;
  roomIds: string[];
  bedroomCount: number;
  bathroomCount: number;
  confidence: number;
  reviewRequired: boolean;
}

export interface HierarchyFloor {
  id: string;
  /** Display name, e.g. "Level 2" or "Floor 1". */
  levelName: string;
  levelIndex: number;
  pageId: string;
  pageNumber: number;
  documentId?: string | null;
  sourceFileName?: string | null;
  isFloorPlan: boolean;
  unitIds: string[];
  commonAreaIds: string[];
  /** Rooms not assigned to a unit and not marked common (needs review). */
  unassignedRoomIds: string[];
  properties: {
    unitCount: number;
    roomCount: number;
    commonAreaCount: number;
    grossAreaM2?: number | null;
    commonAreaM2?: number | null;
  };
}

export interface BuildingHierarchy {
  schemaVersion: "1.0.0";
  buildingId: string;
  projectId: string;
  analysisId: string;
  name: string;
  floors: HierarchyFloor[];
  units: HierarchyUnit[];
  rooms: HierarchyRoom[];
  objects: HierarchyObject[];
  /** Convenience mirrors of AnalysisResult lists when present. */
  spaces?: Space[];
  openings?: Opening[];
  unitRecords?: Unit[];
  createdAt: string;
  updatedAt: string;
}

export const HIERARCHY_SCHEMA_VERSION = "1.0.0" as const;

/** Labels treated as floor common areas (not private to a unit). */
export const COMMON_AREA_LABELS: readonly string[] = [
  "Communal Space",
  "Lobby",
  "Stair",
  "Lift",
  "common_corridor",
  "Common Corridor",
] as const;
