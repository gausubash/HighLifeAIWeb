import { describe, expect, it } from "vitest";
import type { OverlayEntity } from "./types";
import { countModelFamilyEntities } from "./usePageRegionDetect";

function entity(type: OverlayEntity["type"], source = "model"): OverlayEntity {
  return {
    id: `${type}-${source}`,
    type,
    layer: "rooms",
    geometry: { kind: "rect", x: 0, y: 0, width: 1, height: 1 },
    label: type,
    confidence: 1,
    status: "accepted",
    source,
    attributes: {},
    createdAt: "",
    updatedAt: "",
  };
}

describe("countModelFamilyEntities", () => {
  it("returns the shared empty snapshot when there are no model entities", () => {
    const empty = countModelFamilyEntities([]);
    expect(empty).toEqual({ walls: 0, rooms: 0, openings: 0, objects: 0, north: 0 });
    expect(countModelFamilyEntities([entity("wall", "manual")])).toBe(empty);
  });

  it("groups model entities by detect family", () => {
    expect(
      countModelFamilyEntities([
        entity("wall"),
        entity("room"),
        entity("unit_boundary"),
        entity("door"),
        entity("window"),
        entity("north_arrow"),
        entity("wall", "manual"),
      ]),
    ).toEqual({ walls: 1, rooms: 2, openings: 2, objects: 0, north: 1 });
  });
});
