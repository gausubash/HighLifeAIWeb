import type { StudioTask } from "./types";

export type StudioModelCategory =
  | "layout_analysis"
  | "wall_detection"
  | "room_detection"
  | "wall_segmentation"
  | "general_detection"
  | "general_segmentation";

export type StudioDatasetCategorySpec = {
  id: StudioModelCategory;
  label: string;
  task: StudioTask;
  default_base: string;
  class_names: string[];
};

export const STUDIO_CATEGORY_LABELS: Record<StudioModelCategory, string> = {
  layout_analysis: "Layout analysis",
  wall_detection: "Wall detection",
  room_detection: "Room & fixture detection",
  wall_segmentation: "Wall segmentation",
  general_detection: "General object detection",
  general_segmentation: "General instance segmentation",
};

export const FALLBACK_DATASET_CATEGORIES: StudioDatasetCategorySpec[] = [
  {
    id: "layout_analysis",
    label: STUDIO_CATEGORY_LABELS.layout_analysis,
    task: "detect",
    default_base: "yolo_layout.pt",
    class_names: [
      "Title block",
      "Drawing area",
      "Legend block",
      "Drawing border",
      "Revision block",
    ],
  },
  {
    id: "wall_detection",
    label: STUDIO_CATEGORY_LABELS.wall_detection,
    task: "detect",
    default_base: "yolo_walls_obb.pt",
    class_names: ["Wall", "External Wall"],
  },
  {
    id: "room_detection",
    label: STUDIO_CATEGORY_LABELS.room_detection,
    task: "detect",
    default_base: "yolo_room.pt",
    class_names: [
      "Unit",
      "Open Living",
      "Bedroom",
      "Bathroom",
      "Ensuite",
      "Laundry",
      "Closet",
      "Store",
      "Balcony",
      "Lobby",
      "Communal Space",
      "Wall",
      "External Wall",
      "Single Door",
      "Sliding Door",
      "Main Door",
      "Window",
      "Stair",
      "Lift",
    ],
  },
  {
    id: "wall_segmentation",
    label: STUDIO_CATEGORY_LABELS.wall_segmentation,
    task: "segment",
    default_base: "mitunet_walls.pth",
    class_names: ["Wall", "External Wall"],
  },
  {
    id: "general_detection",
    label: STUDIO_CATEGORY_LABELS.general_detection,
    task: "detect",
    default_base: "yolov8n.pt",
    class_names: ["Unit", "Bedroom", "Bathroom", "Wall", "Window", "Door"],
  },
  {
    id: "general_segmentation",
    label: STUDIO_CATEGORY_LABELS.general_segmentation,
    task: "segment",
    default_base: "yolov8n-seg.pt",
    class_names: ["Wall", "External Wall", "Unit"],
  },
];

export function categoryLabel(id: string | null | undefined): string {
  if (!id) return "Uncategorized";
  return STUDIO_CATEGORY_LABELS[id as StudioModelCategory] ?? id;
}

export function basesForDatasetCategory(
  catalog: { id: string; task: string; category?: string | null }[],
  task: StudioTask,
  category?: string | null,
): string[] {
  const taskItems = catalog.filter((m) => m.task === task);
  if (!category) return taskItems.map((m) => m.id);
  const matched = taskItems.filter(
    (m) => m.category === category || (m.category ?? "").startsWith("general_"),
  );
  return (matched.length ? matched : taskItems).map((m) => m.id);
}
