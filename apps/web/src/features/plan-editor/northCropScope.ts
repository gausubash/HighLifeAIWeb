import { padNormalizedCrop, type NormalizedCrop } from "@/lib/scale/layoutRegionCrop";

export type NorthCropScope = "title" | "drawing" | "page";

/** Extra pad so a compass sitting just outside the title block is still in-frame. */
const TITLE_SEARCH_PAD = 0.12;

export const NORTH_CROP_OPTIONS: { id: NorthCropScope; label: string; hint: string }[] = [
  { id: "title", label: "Title", hint: "Layout title block (usual place for north arrows)" },
  { id: "drawing", label: "Drawing", hint: "Main floorplan region from layout detect" },
  { id: "page", label: "Page", hint: "Whole sheet — slower, catches arrows anywhere" },
];

export function resolveNorthDetectCrop(
  scope: NorthCropScope,
  crops: { title: NormalizedCrop | null; drawing: NormalizedCrop | null },
): { crop: NormalizedCrop | null; used: NorthCropScope; warning: string | null } {
  if (scope === "page") {
    return { crop: null, used: "page", warning: null };
  }
  if (scope === "drawing") {
    if (crops.drawing) return { crop: crops.drawing, used: "drawing", warning: null };
    return {
      crop: null,
      used: "page",
      warning:
        "No drawing area — run layout detect first, or pick Title. Searching the whole page.",
    };
  }
  if (crops.title) {
    return { crop: padNormalizedCrop(crops.title, TITLE_SEARCH_PAD), used: "title", warning: null };
  }
  return {
    crop: null,
    used: "page",
    warning:
      "No title block — run layout detect first, or pick Drawing / Page. Searching the whole page.",
  };
}
