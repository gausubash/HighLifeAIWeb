import { describe, expect, it } from "vitest";
import { FALLBACK_DATASET_CATEGORIES, groupBaseModelsByCategory } from "./categories";

describe("groupBaseModelsByCategory", () => {
  it("lists every catalog id, not just the selected dataset category", () => {
    const catalog = [
      { id: "mitunet_walls.pth", category: "wall_segmentation" },
      { id: "yolov8n-seg.pt", category: "room_types" },
      { id: "yolo_layout.pt", category: "layout_analysis" },
      { id: "yolov8n.pt", category: "object_detection" },
      { id: "custom.pt", category: null },
    ];
    const groups = groupBaseModelsByCategory(catalog, FALLBACK_DATASET_CATEGORIES);
    expect(groups.map((g) => g.id)).toEqual([
      "layout_analysis",
      "wall_segmentation",
      "room_types",
      "object_detection",
      "other",
    ]);
    expect(groups.flatMap((g) => g.ids)).toEqual([
      "yolo_layout.pt",
      "mitunet_walls.pth",
      "yolov8n-seg.pt",
      "yolov8n.pt",
      "custom.pt",
    ]);
  });

  it("falls back when the catalog is empty", () => {
    expect(groupBaseModelsByCategory([], FALLBACK_DATASET_CATEGORIES, ["yolov8n.pt"])).toEqual([
      { id: "all", label: "Available", ids: ["yolov8n.pt"] },
    ]);
  });

  it("lists YOLO pose bases under north arrow", () => {
    const catalog = [
      {
        id: "yolo26n-pose.pt",
        category: "north_arrow",
        categories: ["north_arrow"],
      },
      { id: "yolo_room.pt", category: "object_detection" },
    ];
    const groups = groupBaseModelsByCategory(catalog, FALLBACK_DATASET_CATEGORIES);
    expect(groups.find((g) => g.id === "north_arrow")?.ids).toEqual(["yolo26n-pose.pt"]);
    expect(groups.find((g) => g.id === "object_detection")?.ids).toEqual(["yolo_room.pt"]);
  });
});
