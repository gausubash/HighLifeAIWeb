import type { InferOverlayEntity } from "./inferUnitBoundaries";

export type UnitBoundaryHeadMode = "structural_named" | "room_segmentation";

const STRUCTURAL_SOURCES = new Set(["roboflow-floorplan-seg"]);

export function isStructuralEntity(entity: InferOverlayEntity): boolean {
  if (entity.source !== "model") return false;
  const attrs = entity.attributes ?? {};
  if (attrs.detectFamily === "structural") return true;
  const source = typeof attrs.source === "string" ? attrs.source : "";
  return STRUCTURAL_SOURCES.has(source);
}

/**
 * Prefer Roboflow floorplan-seg walls/doors when present; otherwise fall back to any model walls/doors.
 */
export function barrierEntitiesForUnitInference(entities: InferOverlayEntity[]): {
  walls: InferOverlayEntity[];
  doors: InferOverlayEntity[];
  hasStructural: boolean;
} {
  const live = entities.filter((e) => e.status !== "rejected");
  const structural = live.filter(isStructuralEntity);
  if (structural.length) {
    return {
      walls: structural.filter((e) => e.type === "wall"),
      doors: structural.filter((e) => e.type === "door"),
      hasStructural: true,
    };
  }
  return {
    walls: live.filter((e) => e.source === "model" && e.type === "wall"),
    doors: live.filter((e) => e.source === "model" && e.type === "door"),
    hasStructural: false,
  };
}

/**
 * OCR unit names → structural segmentation boundaries (wall flood-fill).
 * No OCR unit names → room segmentation (YOLO units / room clusters).
 */
export function resolveUnitBoundaryHeadMode(input: { ocrUnitSeedCount: number }): UnitBoundaryHeadMode {
  return input.ocrUnitSeedCount > 0 ? "structural_named" : "room_segmentation";
}
