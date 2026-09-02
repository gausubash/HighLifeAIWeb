import { describe, expect, it } from "vitest";
import type { OverlayEntity } from "./types";
import { dedupeOverlayEntities } from "./useOverlayStore";

function entity(id: string): OverlayEntity {
  return {
    id,
    type: "wall",
    layer: "structure",
    geometry: { kind: "rect", x: 0, y: 0, width: 1, height: 1 },
    label: "Wall",
    confidence: 1,
    status: "predicted",
    source: "model",
    attributes: {},
    createdAt: "",
    updatedAt: "",
  };
}

describe("dedupeOverlayEntities", () => {
  it("keeps the first entity when ids repeat", () => {
    const first = entity("aca18112-608b-479c-8eef-33db3b06454e");
    const duplicate = { ...entity("aca18112-608b-479c-8eef-33db3b06454e"), label: "Duplicate" };
    expect(dedupeOverlayEntities([first, duplicate])).toEqual([first]);
  });
});
