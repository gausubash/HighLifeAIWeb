/**
 * Minimal specialist inventory for HighLife FPR.
 * Late fusion only — each head is independently trained and tiled.
 */

export type SpecialistRole =
  | "layout"
  | "walls"
  | "structural"
  | "units_rooms"
  | "openings"
  | "north"
  | "ocr"
  | "vlm";

export type SpecialistLearningTask =
  | "object_detection"
  | "semantic_segmentation"
  | "instance_segmentation"
  | "oriented_detection"
  | "text_spotting"
  | "graph_reasoning";

export type FprSpecialist = {
  role: SpecialistRole;
  name: string;
  learningTask: SpecialistLearningTask;
  catalogTokens: string[];
  studioCategory: string | null;
  output: string;
  tiled: boolean;
  reasonerOnly?: boolean;
};

export const FPR_SPECIALISTS: readonly FprSpecialist[] = [
  {
    role: "layout",
    name: "Layout ROI",
    learningTask: "object_detection",
    catalogTokens: ["layout:greenmap"],
    studioCategory: "layout_analysis",
    output: "Drawing area, title block, legend",
    tiled: false,
  },
  {
    role: "walls",
    name: "Structural walls",
    learningTask: "semantic_segmentation",
    catalogTokens: ["wall:mitunet", "wall:roboflow"],
    studioCategory: "wall_segmentation",
    output: "internal_wall / external_wall masks",
    tiled: true,
  },
  {
    role: "structural",
    name: "Structural (wall/door/window)",
    learningTask: "instance_segmentation",
    catalogTokens: ["structural:roboflow-seg"],
    studioCategory: "structural_detection",
    output: "Walls, doors, and windows for unit boundary head",
    tiled: true,
  },
  {
    role: "units_rooms",
    name: "Units and rooms",
    learningTask: "instance_segmentation",
    catalogTokens: ["room:architect", "room:roboflow"],
    studioCategory: "room_types",
    output: "Instance masks per unit and room",
    tiled: true,
  },
  {
    role: "openings",
    name: "Openings",
    learningTask: "object_detection",
    catalogTokens: ["opening:architect"],
    studioCategory: "opening_detection",
    output: "Doors and windows",
    tiled: true,
  },
  {
    role: "north",
    name: "North arrow",
    learningTask: "oriented_detection",
    catalogTokens: ["symbol:north"],
    studioCategory: "north_arrow",
    output: "Heading vector (not OCR)",
    tiled: true,
  },
  {
    role: "ocr",
    name: "OCR",
    learningTask: "text_spotting",
    catalogTokens: ["ocr:paddle"],
    studioCategory: null,
    output: "Labels, scale text, communal location",
    tiled: true,
  },
  {
    role: "vlm",
    name: "VLM reasoner",
    learningTask: "graph_reasoning",
    catalogTokens: ["vlm:graph"],
    studioCategory: null,
    output: "Narrative on the scene graph only",
    tiled: false,
    reasonerOnly: true,
  },
];

export function specialistByRole(role: SpecialistRole): FprSpecialist | undefined {
  return FPR_SPECIALISTS.find((s) => s.role === role);
}

export function trainableSpecialists(): FprSpecialist[] {
  return FPR_SPECIALISTS.filter((s) => s.studioCategory && !s.reasonerOnly);
}
