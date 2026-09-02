import { describe, expect, it } from "vitest";
import { labelIsHidden, overlayGroupFor } from "./overlayVisibility";

describe("overlayGroupFor", () => {
  it("groups sheet regions as layout", () => {
    expect(overlayGroupFor({ type: "title_block", label: "Title block" })).toBe("layout");
    expect(overlayGroupFor({ type: "main_floorplan", label: "Main drawing" })).toBe("layout");
  });

  it("groups walls, rooms, units, and other detections", () => {
    expect(overlayGroupFor({ type: "wall", label: "Wall" })).toBe("walls");
    expect(overlayGroupFor({ type: "room", label: "Bedroom" })).toBe("rooms");
    expect(overlayGroupFor({ type: "unit_boundary", label: "Unit 5A" })).toBe("units");
    expect(overlayGroupFor({ type: "room", label: "Unit" })).toBe("units");
    expect(overlayGroupFor({ type: "door", label: "Single Door" })).toBe("openings");
    expect(overlayGroupFor({ type: "window", label: "Window" })).toBe("openings");
    expect(overlayGroupFor({ type: "stair", label: "Stair" })).toBe("objects");
    expect(overlayGroupFor({ type: "north_arrow", label: "North arrow" })).toBe("objects");
    expect(overlayGroupFor({ type: "other", label: "North" })).toBe("objects");
    expect(overlayGroupFor({ type: "other", label: "Bedroom" })).toBe("rooms");
  });

  it("treats hiddenLabels as case-insensitive", () => {
    expect(labelIsHidden({ Bedroom: true }, "Bedroom")).toBe(true);
    expect(labelIsHidden({ Bedroom: true }, "bedroom")).toBe(true);
    expect(labelIsHidden({ bedroom: true }, "Bedroom")).toBe(true);
    expect(labelIsHidden({ Bedroom: false }, "Bedroom")).toBe(false);
  });
});
