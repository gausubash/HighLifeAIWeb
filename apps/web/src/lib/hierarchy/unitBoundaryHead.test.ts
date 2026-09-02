import { describe, expect, it } from "vitest";
import {
  barrierEntitiesForUnitInference,
  isStructuralEntity,
  resolveUnitBoundaryHeadMode,
} from "./unitBoundaryHead";
import type { InferOverlayEntity } from "./inferUnitBoundaries";

function entity(
  id: string,
  type: string,
  extra?: Partial<InferOverlayEntity>,
): InferOverlayEntity {
  return {
    id,
    type,
    label: type,
    geometry: { kind: "rect", x: 0, y: 0, width: 10, height: 10 },
    source: "model",
    attributes: {},
    ...extra,
  };
}

describe("unitBoundaryHead", () => {
  it("detects structural entities by detectFamily or source", () => {
    expect(
      isStructuralEntity(
        entity("w1", "wall", { attributes: { detectFamily: "structural" } }),
      ),
    ).toBe(true);
    expect(
      isStructuralEntity(
        entity("d1", "door", { attributes: { source: "roboflow-floorplan-seg" } }),
      ),
    ).toBe(true);
    expect(isStructuralEntity(entity("w2", "wall"))).toBe(false);
  });

  it("prefers structural walls and doors for barriers", () => {
    const entities = [
      entity("mit", "wall", { id: "mit" }),
      entity("seg", "wall", { id: "seg", attributes: { detectFamily: "structural" } }),
      entity("door", "door", { id: "door", attributes: { detectFamily: "structural" } }),
    ];
    const barrier = barrierEntitiesForUnitInference(entities);
    expect(barrier.hasStructural).toBe(true);
    expect(barrier.walls.map((e) => e.id)).toEqual(["seg"]);
    expect(barrier.doors.map((e) => e.id)).toEqual(["door"]);
  });

  it("chooses structural_named when OCR unit seeds exist", () => {
    expect(resolveUnitBoundaryHeadMode({ ocrUnitSeedCount: 0 })).toBe("room_segmentation");
    expect(resolveUnitBoundaryHeadMode({ ocrUnitSeedCount: 2 })).toBe("structural_named");
  });
});
