import { isNorthArrowLabel } from "./compassKeypointAnnotate";
import { isUnitOutlineEntity } from "./labelClasses";
import { isLayoutEntity } from "./layoutRegionClasses";

export const OVERLAY_VISIBILITY_GROUPS = [
  { id: "layout", label: "Layout", hint: "Main drawing, title block, legend, border" },
  { id: "ocr", label: "OCR text", hint: "Recognized text on the plan" },
  { id: "walls", label: "Walls", hint: "Wall segmentation" },
  { id: "rooms", label: "Rooms", hint: "Room-type regions" },
  { id: "openings", label: "Openings", hint: "Doors and windows" },
  { id: "objects", label: "Fixtures", hint: "Stairs, lifts, and other fixtures" },
  { id: "units", label: "Units", hint: "Detected or inferred unit outlines" },
] as const;

export type OverlayVisibilityGroup = (typeof OVERLAY_VISIBILITY_GROUPS)[number]["id"];

export type OverlayEntityGroup = Exclude<OverlayVisibilityGroup, "ocr">;

export const DEFAULT_OVERLAY_GROUP_VISIBLE: Record<OverlayVisibilityGroup, boolean> = {
  layout: true,
  ocr: true,
  walls: true,
  rooms: true,
  openings: true,
  objects: true,
  units: true,
};

const ROOM_TYPE_LABELS = new Set([
  "open living",
  "bedroom",
  "bathroom",
  "ensuite",
  "laundry",
  "closet",
  "store",
  "balcony",
  "lobby",
  "communal space",
  "corridor",
  "hallway",
  "hall",
  "foyer",
  "kitchen",
  "dining",
  "living",
  "toilet",
]);

export function labelIsHidden(hiddenLabels: Record<string, boolean> | undefined, label: string): boolean {
  if (!hiddenLabels || !label) return false;
  if (hiddenLabels[label]) return true;
  const n = label.trim().toLowerCase();
  for (const [key, hidden] of Object.entries(hiddenLabels)) {
    if (hidden && key.trim().toLowerCase() === n) return true;
  }
  return false;
}

export function overlayGroupFor(entity: {
  type?: string;
  label?: string;
  attributes?: Record<string, unknown>;
}): OverlayEntityGroup {
  if (isLayoutEntity(entity)) return "layout";
  const type = (entity.type ?? "").trim().toLowerCase();
  const label = (entity.label ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (type === "north_arrow" || isNorthArrowLabel(label)) return "objects";
  if (type === "wall" || label === "wall" || label === "external wall") return "walls";
  if (isUnitOutlineEntity({ type: entity.type ?? "", label: entity.label })) return "units";
  if (type === "room" || ROOM_TYPE_LABELS.has(label)) return "rooms";
  if (type === "door" || type === "window") return "openings";
  return "objects";
}
