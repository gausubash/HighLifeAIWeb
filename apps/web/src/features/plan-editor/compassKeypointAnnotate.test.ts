import { describe, expect, it } from "vitest";
import {
  hitTestCompassKeypoint,
  isCompassKeypointLabel,
  isNorthArrowEntity,
  placeCompassKeypointOnEntity,
} from "./compassKeypointAnnotate";
import { makeLabeledEntity } from "./labelClasses";

describe("compassKeypointAnnotate", () => {
  it("recognizes north arrows and keypoint labels", () => {
    expect(isNorthArrowEntity({ type: "north_arrow", label: "Compass" })).toBe(true);
    expect(isNorthArrowEntity({ type: "other", label: "North" })).toBe(true);
    expect(isNorthArrowEntity({ type: "room", label: "Bedroom" })).toBe(false);
    expect(isCompassKeypointLabel("tip")).toBe("tip");
    expect(isCompassKeypointLabel("arrow_base")).toBe("base");
    expect(isCompassKeypointLabel("Bedroom")).toBeNull();
  });

  it("treats the North class as a north arrow when placing tip/base", () => {
    const entity = makeLabeledEntity("North", {
      kind: "rect",
      x: 0,
      y: 0,
      width: 10,
      height: 40,
    });
    expect(entity.type).toBe("north_arrow");
    const next = placeCompassKeypointOnEntity(entity, "tip", { x: 5, y: 2 });
    expect(next.type).toBe("north_arrow");
    const keypoints = next.attributes.keypoints as Array<{ name: string; x: number; y: number }>;
    expect(keypoints.find((k) => k.name === "tip")).toMatchObject({ x: 5, y: 2 });
  });

  it("coerces a North-labeled other box to north_arrow when placing", () => {
    const entity = {
      ...makeLabeledEntity("Bedroom", { kind: "rect", x: 0, y: 0, width: 10, height: 40 }),
      type: "other" as const,
      label: "North",
    };
    const next = placeCompassKeypointOnEntity(entity, "base", { x: 5, y: 38 });
    expect(next.type).toBe("north_arrow");
    const keypoints = next.attributes.keypoints as Array<{ name: string; x: number; y: number }>;
    expect(keypoints.find((k) => k.name === "base")).toMatchObject({ x: 5, y: 38 });
  });

  it("places a tip on the selected compass", () => {
    const entity = makeLabeledEntity("North Arrow", {
      kind: "rect",
      x: 0,
      y: 0,
      width: 10,
      height: 40,
    });
    const next = placeCompassKeypointOnEntity(entity, "tip", { x: 5, y: 2 });
    const keypoints = next.attributes.keypoints as Array<{ name: string; x: number; y: number }>;
    expect(keypoints.find((k) => k.name === "tip")).toMatchObject({ x: 5, y: 2 });
  });

  it("hits a nearby tip", () => {
    const entity = placeCompassKeypointOnEntity(
      makeLabeledEntity("North Arrow", { kind: "rect", x: 0, y: 0, width: 10, height: 40 }),
      "tip",
      { x: 5, y: 2 },
    );
    expect(hitTestCompassKeypoint({ x: 6, y: 3 }, [entity], 4)?.name).toBe("tip");
    expect(hitTestCompassKeypoint({ x: 80, y: 80 }, [entity], 4)).toBeNull();
  });
});
