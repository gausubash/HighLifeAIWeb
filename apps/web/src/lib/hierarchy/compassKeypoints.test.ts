import { describe, expect, it } from "vitest";
import {
  cocoVisibility,
  compassKeypointRole,
  deriveCompassKeypoints,
  headingFromCompassKeypoints,
  pageBearingFromTipBase,
  isCompassKeypointDrawable,
  offsetCompassKeypoints,
  parseCompassKeypoints,
  patchCompassKeypointVisibility,
  resolveCompassKeypoints,
} from "./compassKeypoints";

describe("cocoVisibility", () => {
  it("maps Roboflow / COCO values", () => {
    expect(cocoVisibility(2)).toBe("visible");
    expect(cocoVisibility(1)).toBe("occluded");
    expect(cocoVisibility(0)).toBe("not_labeled");
    expect(cocoVisibility("visible")).toBe("visible");
    expect(cocoVisibility("occluded")).toBe("occluded");
    expect(cocoVisibility(false)).toBe("not_labeled");
    expect(cocoVisibility(true)).toBe("visible");
  });
});

describe("compassKeypointRole", () => {
  it("maps named keypoints and Roboflow tail→head order", () => {
    expect(compassKeypointRole("arrow_tip", 0, 2)).toBe("tip");
    expect(compassKeypointRole("tail", 1, 2)).toBe("base");
    expect(compassKeypointRole(null, 0, 2)).toBe("base");
    expect(compassKeypointRole(null, 1, 2)).toBe("tip");
    expect(compassKeypointRole(null, 0, 17)).toBeNull();
  });
});

describe("parseCompassKeypoints", () => {
  it("reads a Roboflow keypoints array", () => {
    const keypoints = parseCompassKeypoints({
      keypoints: [
        { class: "base", x: 10, y: 40, visibility: 2, confidence: 0.9 },
        { class: "tip", x: 10, y: 10, visibility: 1, confidence: 0.8 },
      ],
    });
    expect(keypoints).toHaveLength(2);
    expect(keypoints[0]).toMatchObject({ name: "tip", x: 10, y: 10, visibility: "occluded" });
    expect(keypoints[1]).toMatchObject({ name: "base", x: 10, y: 40, visibility: "visible" });
    expect(headingFromCompassKeypoints(keypoints)).toBeCloseTo(270, 5);
  });

  it("reads page bearing from tip and base (0° = top of sheet, clockwise)", () => {
    expect(pageBearingFromTipBase({ x: 10, y: 40 }, { x: 10, y: 10 })).toBeCloseTo(0, 5);
    expect(pageBearingFromTipBase({ x: 10, y: 10 }, { x: 40, y: 10 })).toBeCloseTo(90, 5);
    expect(pageBearingFromTipBase({ x: 10, y: 10 }, { x: 10, y: 40 })).toBeCloseTo(180, 5);
    expect(pageBearingFromTipBase({ x: 40, y: 10 }, { x: 10, y: 10 })).toBeCloseTo(270, 5);
  });

  it("reads a COCO flat array with two unnamed points", () => {
    const keypoints = parseCompassKeypoints({ keypoints: [4, 8, 2, 4, 0, 2] });
    expect(keypoints.map((k) => k.name)).toEqual(["tip", "base"]);
    expect(keypoints.find((k) => k.name === "base")).toMatchObject({ x: 4, y: 8 });
    expect(keypoints.find((k) => k.name === "tip")).toMatchObject({ x: 4, y: 0 });
  });
});

describe("deriveCompassKeypoints", () => {
  it("places tip at the heading extrema of a north-arrow box", () => {
    const derived = deriveCompassKeypoints(
      [
        { x: 0, y: 0 },
        { x: 0, y: -20 },
        { x: 4, y: -20 },
        { x: 4, y: 0 },
      ],
      270,
    );
    expect(derived.find((k) => k.name === "tip")?.y).toBe(-20);
    expect(derived.find((k) => k.name === "base")?.y).toBe(0);
  });
});

describe("resolve and visibility", () => {
  it("draws placed tip and base whenever the overlay toggle is on", () => {
    const keypoints = resolveCompassKeypoints(
      {
        keypoints: [
          { name: "tip", x: 1, y: 1, visibility: "visible" },
          { name: "base", x: 0, y: 0, visibility: "visible" },
        ],
      },
      [],
    );
    expect(isCompassKeypointDrawable(keypoints.find((k) => k.name === "tip"), true)).toBe(true);
    expect(isCompassKeypointDrawable(keypoints.find((k) => k.name === "base"), true)).toBe(true);
    expect(isCompassKeypointDrawable(keypoints.find((k) => k.name === "base"), false)).toBe(false);
  });

  it("patches Roboflow visibility on stored keypoints", () => {
    const next = patchCompassKeypointVisibility(
      { keypoints: [{ name: "tip", x: 2, y: 2, visibility: "visible" }] },
      "tip",
      "occluded",
      [{ x: 0, y: 0 }],
    );
    expect(parseCompassKeypoints(next).find((k) => k.name === "tip")?.visibility).toBe("occluded");
  });

  it("offsets keypoints with the parent polygon", () => {
    const moved = offsetCompassKeypoints(
      [{ name: "tip", x: 2, y: 3, visibility: "visible" }],
      10,
      -4,
    );
    expect(moved[0]).toMatchObject({ x: 12, y: -1 });
  });
});
