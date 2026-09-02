import { describe, expect, it } from "vitest";
import {
  detectActionLabel,
  detectTaskFromModelId,
  replaceTypesForDetectTask,
  showsMitunetWallOptions,
} from "./detectTask";

describe("detectTaskFromModelId", () => {
  it("maps builtin tokens to tasks", () => {
    expect(detectTaskFromModelId("wall:mitunet")).toBe("walls");
    expect(detectTaskFromModelId("wall:roboflow")).toBe("walls");
    expect(detectTaskFromModelId("room:architect")).toBe("rooms");
    expect(detectTaskFromModelId("room:roboflow")).toBe("rooms");
    expect(detectTaskFromModelId("object:architect")).toBe("objects");
    expect(detectTaskFromModelId("opening:architect")).toBe("openings");
    expect(detectTaskFromModelId("structural:roboflow-seg")).toBe("structural");
    expect(detectTaskFromModelId("structural:roboflow-seg", "structural_detection")).toBe("structural");
    expect(detectTaskFromModelId("symbol:north")).toBe("north");
    expect(detectTaskFromModelId("layout:greenmap")).toBe("layout");
  });

  it("maps studio category to the same task", () => {
    expect(detectTaskFromModelId("studio:abc", "wall_segmentation")).toBe("walls");
    expect(detectTaskFromModelId("studio:abc", "room_types")).toBe("rooms");
    expect(detectTaskFromModelId("studio:abc", "object_detection")).toBe("objects");
  });
});

describe("replaceTypesForDetectTask", () => {
  it("keeps wall vs room vs object types separate", () => {
    expect(replaceTypesForDetectTask("walls")).toEqual(["wall"]);
    expect(replaceTypesForDetectTask("rooms")).toEqual(["room", "unit_boundary"]);
    expect(replaceTypesForDetectTask("openings")).toEqual(["door", "window"]);
    expect(replaceTypesForDetectTask("structural")).toEqual(["wall", "door", "window"]);
    expect(replaceTypesForDetectTask("objects")).toContain("stair");
    expect(replaceTypesForDetectTask("objects")).not.toContain("door");
  });
});

describe("showsMitunetWallOptions", () => {
  it("shows MitUNet options for raster wall models only", () => {
    expect(showsMitunetWallOptions("wall:mitunet", "walls")).toBe(true);
    expect(showsMitunetWallOptions("studio:abc", "walls")).toBe(true);
    expect(showsMitunetWallOptions("room:architect", "rooms")).toBe(false);
  });
});

describe("detectActionLabel", () => {
  it("labels the detect button by task", () => {
    expect(detectActionLabel("walls")).toBe("Detect walls");
    expect(detectActionLabel("rooms")).toBe("Detect rooms");
    expect(detectActionLabel("openings")).toBe("Detect openings");
    expect(detectActionLabel("objects")).toBe("Detect objects");
    expect(detectActionLabel("north")).toBe("Detect north");
  });
});
