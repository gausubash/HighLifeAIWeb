import type { PlanEntityType } from "@highlife/shared-types";
import { LAYOUT_REGION_TYPES } from "./layoutRegionClasses";

export type DetectTask = "walls" | "rooms" | "openings" | "objects" | "north" | "layout" | "studio" | "structural";

const LAYOUT_TYPES = LAYOUT_REGION_TYPES.map((item) => item.type) as PlanEntityType[];

export function detectTaskFromModelId(id: string, category?: string | null): DetectTask {
  const raw = (id || "").trim();
  const cat = (category || "").trim();
  if (raw.startsWith("layout:") || cat === "layout_analysis") return "layout";
  if (raw.startsWith("room:") || cat === "room_types" || cat === "room_detection") return "rooms";
  if (raw.startsWith("structural:") || cat === "structural_detection") return "structural";
  if (raw.startsWith("opening:") || cat === "opening_detection") return "openings";
  if (raw.startsWith("object:") || cat === "object_detection" || cat === "general_detection") {
    return "objects";
  }
  if (raw.startsWith("symbol:") || raw.startsWith("north:") || cat === "north_arrow") {
    return "north";
  }
  if (raw.startsWith("wall:") || cat === "wall_segmentation" || cat === "wall_detection") {
    return "walls";
  }
  if (raw.startsWith("studio:")) return "studio";
  return "walls";
}

export function detectActionLabel(task: DetectTask): string {
  switch (task) {
    case "rooms":
      return "Detect rooms";
    case "openings":
      return "Detect openings";
    case "structural":
      return "Detect structural";
    case "objects":
      return "Detect objects";
    case "north":
      return "Detect north";
    case "layout":
      return "Detect layout";
    default:
      return "Detect walls";
  }
}

export function showsMitunetWallOptions(modelId: string, task: DetectTask): boolean {
  const id = (modelId || "").trim();
  if (!id) return false;
  if (id === "wall:mitunet") return true;
  return task === "walls" && (id.startsWith("studio:") || id.startsWith("wall:"));
}

export function replaceTypesForDetectTask(task: DetectTask): PlanEntityType[] | undefined {
  switch (task) {
    case "walls":
      return ["wall"];
    case "rooms":
      return ["room", "unit_boundary"];
    case "openings":
      return ["door", "window"];
    case "structural":
      return ["wall", "door", "window"];
    case "objects":
      return ["stair", "fixture", "other"];
    case "north":
      return ["north_arrow"];
    case "layout":
      return LAYOUT_TYPES;
    default:
      return undefined;
  }
}
