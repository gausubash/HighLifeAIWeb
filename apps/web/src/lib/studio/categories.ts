import type { StudioTask } from "./types";

export type StudioModelCategory =
  | "layout_analysis"
  | "wall_segmentation"
  | "structural_detection"
  | "room_types"
  | "opening_detection"
  | "object_detection"
  | "north_arrow";

export type StudioDatasetCategorySpec = {
  id: StudioModelCategory;
  label: string;
  task: StudioTask;
  default_base: string;
  class_names: string[];
};

export const STUDIO_CATEGORY_LABELS: Record<StudioModelCategory, string> = {
  layout_analysis: "Layout analysis",
  wall_segmentation: "Wall segmentation",
  structural_detection: "Structural detection",
  room_types: "Room type segmentation",
  opening_detection: "Opening detection",
  object_detection: "Object detection",
  north_arrow: "North arrow",
};

const CATEGORY_ALIASES: Record<string, StudioModelCategory> = {
  wall_detection: "wall_segmentation",
  room_detection: "room_types",
  general_detection: "object_detection",
  general_segmentation: "room_types",
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
    id: "wall_segmentation",
    label: STUDIO_CATEGORY_LABELS.wall_segmentation,
    task: "segment",
    default_base: "mitunet_walls.pth",
    class_names: ["Wall", "External Wall"],
  },
  {
    id: "structural_detection",
    label: STUDIO_CATEGORY_LABELS.structural_detection,
    task: "segment",
    default_base: "yolo_room.pt",
    class_names: ["Wall", "Door", "Window"],
  },
  {
    id: "room_types",
    label: STUDIO_CATEGORY_LABELS.room_types,
    task: "segment",
    default_base: "yolov8n-seg.pt",
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
    ],
  },
  {
    id: "opening_detection",
    label: STUDIO_CATEGORY_LABELS.opening_detection,
    task: "detect",
    default_base: "yolo_room.pt",
    class_names: ["Single Door", "Sliding Door", "Main Door", "Window"],
  },
  {
    id: "object_detection",
    label: STUDIO_CATEGORY_LABELS.object_detection,
    task: "detect",
    default_base: "yolo_room.pt",
    class_names: ["Stair", "Lift"],
  },
  {
    id: "north_arrow",
    label: STUDIO_CATEGORY_LABELS.north_arrow,
    task: "pose",
    default_base: "yolo26n-pose.pt",
    class_names: ["North Arrow"],
  },
];

export function normalizeStudioCategory(id: string | null | undefined): StudioModelCategory | string | null {
  if (!id) return null;
  return CATEGORY_ALIASES[id] ?? id;
}

export function categoryLabel(id: string | null | undefined): string {
  const normalized = normalizeStudioCategory(id);
  if (!normalized) return "Uncategorized";
  return STUDIO_CATEGORY_LABELS[normalized as StudioModelCategory] ?? String(normalized);
}

function catalogCategories(model: {
  category?: string | null;
  categories?: string[] | null;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [model.category, ...(model.categories ?? [])]) {
    const cat = normalizeStudioCategory(raw);
    if (!cat || seen.has(cat)) continue;
    seen.add(cat);
    out.push(cat);
  }
  return out;
}

export function basesForDatasetCategory(
  catalog: { id: string; task: string; category?: string | null; categories?: string[] | null }[],
  task: StudioTask,
  category?: string | null,
): string[] {
  const taskItems = catalog.filter((m) => m.task === task);
  const cat = normalizeStudioCategory(category);
  if (!cat) return taskItems.map((m) => m.id);
  const matched = taskItems.filter((m) => catalogCategories(m).includes(cat));
  return (matched.length ? matched : taskItems).map((m) => m.id);
}

export type StudioBaseModelGroup = {
  id: string;
  label: string;
  ids: string[];
};

/** Full catalog grouped by category — not filtered to the selected dataset. */
export function groupBaseModelsByCategory(
  catalog: { id: string; category?: string | null; categories?: string[] | null }[],
  specs: { id: string; label: string }[],
  fallbackIds: string[] = [],
): StudioBaseModelGroup[] {
  if (!catalog.length) {
    return fallbackIds.length ? [{ id: "all", label: "Available", ids: fallbackIds }] : [];
  }
  const grouped = new Set<string>();
  const groups: StudioBaseModelGroup[] = [];
  for (const spec of specs) {
    const ids = catalog.filter((m) => catalogCategories(m).includes(spec.id)).map((m) => m.id);
    if (!ids.length) continue;
    groups.push({ id: spec.id, label: spec.label, ids });
    for (const id of ids) grouped.add(id);
  }
  const leftover = catalog.filter((m) => !grouped.has(m.id)).map((m) => m.id);
  if (leftover.length) {
    groups.push({ id: "other", label: "Other", ids: leftover });
  }
  return groups;
}
