import type { BedroomBand, PolicyGuideline, PolicyRule, PolicyRuleKind } from "@highlife/shared-types";
import { formatHooperThreshold } from "./hooperApartmentRules";

export type PolicyGraphicKind =
  | "apartment_size"
  | "living"
  | "pos"
  | "bedroom"
  | "bathroom"
  | "storage"
  | "dual_aspect"
  | "habitable_window"
  | "communal"
  | "room_area"
  | "required_rooms"
  | "walls"
  | "solar"
  | "ventilation"
  | "circulation"
  | "acoustic"
  | "outlook"
  | "parking"
  | "mix"
  | "kitchen"
  | "generic";

export type PolicyBandRow = { key: BedroomBand; label: string; value: number };

export type PolicyExplain = {
  graphic: PolicyGraphicKind;
  summary: string;
  how: string[];
  note?: string;
};

const BANDS: BedroomBand[] = ["0", "1", "2", "3"];

export function bedroomBandLabel(key: BedroomBand): string {
  if (key === "0") return "Studio";
  if (key === "3") return "3+ bed";
  return `${key} bed`;
}

export function ruleBands(rule: PolicyRule): PolicyBandRow[] {
  if (!rule.byBedrooms) return [];
  return BANDS.filter((key) => rule.byBedrooms?.[key] != null).map((key) => ({
    key,
    label: bedroomBandLabel(key),
    value: rule.byBedrooms![key]!,
  }));
}

function bandList(rule: PolicyRule, unit = "m²"): string {
  const rows = ruleBands(rule);
  if (!rows.length) return "";
  return rows.map((row) => `${row.label} ${row.value} ${unit}`).join("; ");
}

const BY_KIND: Record<PolicyRuleKind, (rule: PolicyRule) => PolicyExplain> = {
  apartment_min_internal: (rule) => ({
    graphic: "apartment_size",
    summary:
      `Each dwelling’s internal floor area must meet a minimum that grows with bedroom count` +
      (bandList(rule) ? ` — ${bandList(rule)}` : "") +
      ". Internal area is the unit outline inside the walls. Balconies, terraces, and shared corridors are excluded.",
    how: [
      "Set scale on the sheet so pixel area converts to square metres.",
      "Infer or draw unit boundaries, then label bedrooms so the dwelling is banded as studio / 1 / 2 / 3+.",
      "The check compares the unit’s internal area to the band for that bedroom count.",
    ],
    note: "ADG 4D dwelling-size bands are the usual apartment-size test used with Victorian BADS functional-layout checks. This is a plan-readability aid, not a statutory determination.",
  }),
  apartment_min_living: (rule) => ({
    graphic: "living",
    summary:
      `The living / lounge / open-living room must be large enough for the dwelling type` +
      (bandList(rule) ? ` — ${bandList(rule)}` : "") +
      (rule.minDimensionM != null ? `. Minimum width ${rule.minDimensionM} m.` : "."),
    how: [
      "Rooms labelled Living, Lounge, Family, or Open Living inside the unit are added together.",
      "The total is compared to the living minimum for the unit’s bedroom band.",
      rule.minDimensionM != null
        ? `The shorter side of the living box should be at least ${rule.minDimensionM} m.`
        : "Width is checked when a minimum dimension is set on the rule.",
    ],
  }),
  apartment_min_pos: (rule) => ({
    graphic: "pos",
    summary:
      `Each dwelling needs usable private open space (balcony, terrace, or courtyard)` +
      (bandList(rule) ? ` — ${bandList(rule)}` : rule.minAreaM2 != null ? ` — ${rule.minAreaM2} m²` : "") +
      (rule.minDimensionM != null
        ? `. The space should be at least ${rule.minDimensionM} m in its shorter dimension so it is usable, not a sliver.`
        : "."),
    how: [
      "Balcony / terrace / courtyard area on the unit is measured after scale is set.",
      "A missing balcony is a fail when the rule requires private open space.",
    ],
  }),
  apartment_min_bedroom: (rule) => ({
    graphic: "bedroom",
    summary:
      `Every bedroom must meet a floor-area minimum` +
      (rule.minAreaM2 != null ? ` (${rule.minAreaM2} m²)` : "") +
      (rule.minDimensionM != null ? ` and a shortest wall of ${rule.minDimensionM} m` : "") +
      ". That keeps a bed, circulation, and a wardrobe possible.",
    how: [
      "Each room classified as Bedroom is measured separately.",
      "A unit fails if any bedroom is under the area (or width) minimum.",
    ],
  }),
  apartment_min_bathrooms: (rule) => ({
    graphic: "bathroom",
    summary: `Every dwelling needs at least ${rule.minCount ?? 1} bathroom (or ensuite). A powder room alone does not replace a bathroom.`,
    how: [
      "Bathroom and ensuite labels on rooms inside the unit are counted.",
      "The count is compared to the required minimum.",
    ],
  }),
  apartment_min_storage: (rule) => ({
    graphic: "storage",
    summary:
      "Each dwelling should show dedicated in-unit storage — a store, robe, wardrobe, or linen — not only kitchen cupboards implied by the plan.",
    how: [
      "Rooms labelled Store, Storage, Robe, Wardrobe, or Linen inside the unit are counted.",
      `At least ${rule.minCount ?? 1} such space is required.`,
    ],
  }),
  apartment_dual_aspect: () => ({
    graphic: "dual_aspect",
    summary:
      "Natural ventilation is read as dual aspect: openings (usually windows) on two different sides of the dwelling so air can cross-ventilate. A single-aspect unit only faces one direction.",
    how: [
      "Window detections are grouped to the unit and checked for two distinct sides.",
      "If the north arrow or window sides are missing, the result is uncertain rather than a silent pass.",
    ],
  }),
  habitable_has_window: () => ({
    graphic: "habitable_window",
    summary:
      "Each habitable room (bedroom, living, dining, study) should have an exterior window on its wall contour so the room can be daylit and naturally ventilated.",
    how: [
      "Geometry extract builds a room graph: windows attach to the nearest wall-bounded room.",
      "A bedroom or living room with no window edge fails. Bathrooms and stores are not checked.",
      "If Geometry has not been run, Detect room/window assignment is used instead.",
    ],
  }),
  communal_open_space: (rule) => ({
    graphic: "communal",
    summary:
      rule.m2PerDwelling != null
        ? `The building needs shared outdoor open space of about ${rule.m2PerDwelling} m² per dwelling (excluding private balconies).`
        : `The building needs a communal outdoor area` +
          (rule.minCommunalM2 != null ? ` of at least ${rule.minCommunalM2} m²` : "") +
          ".",
    how: [
      "Communal / courtyard / podium landscape labelled on the sheet is measured.",
      rule.m2PerDwelling != null
        ? `Required area = ${rule.m2PerDwelling} m² × number of inferred dwellings.`
        : "Required area is the pack minimum for the building.",
    ],
  }),
  room_min_area: (rule) => ({
    graphic: "room_area",
    summary:
      `Matching rooms must be at least ${rule.minAreaM2 ?? "the stated"} m²` +
      (rule.roomLabels?.length ? ` (${rule.roomLabels.join(", ")})` : "") +
      ".",
    how: [
      "Each room whose label matches the rule is measured after scale is set.",
      rule.optionalIfAbsent
        ? "If no matching room is on the page, the rule is skipped."
        : "If no matching room is found, the rule fails.",
    ],
  }),
  required_labels: (rule) => ({
    graphic: "required_rooms",
    summary: `The page must include these room types: ${(rule.requiredLabels ?? []).join(", ") || "as listed"}.`,
    how: ["Labels on drawn or detected rooms are matched, ignoring small spelling differences."],
  }),
  min_wall_count: (rule) => ({
    graphic: "walls",
    summary: `The scene should contain wall geometry (at least ${rule.minWallCount ?? 1} wall region) before area rules are trusted.`,
    how: ["Wall detections or drawn wall regions on the page are counted."],
  }),
};

export function explainPolicyRule(rule: PolicyRule): PolicyExplain {
  const build = BY_KIND[rule.kind];
  return (
    build?.(rule) ?? {
      graphic: "generic",
      summary: rule.explanation?.replace(/\{(\w+)\}/g, "…") || "This rule is evaluated against extracted apartments and rooms.",
      how: ["Run Detect, set scale, and infer units before checking compliance."],
    }
  );
}

export function graphicForGuideline(guideline: PolicyGuideline): PolicyGraphicKind {
  if (guideline.mappedKind) {
    return explainPolicyRule({
      code: guideline.id,
      name: guideline.name,
      kind: guideline.mappedKind,
    }).graphic;
  }
  const id = `${guideline.id} ${guideline.variable ?? ""}`.toLowerCase();
  const element = guideline.designElement ?? "";
  if (id.includes("bedroom") && (id.includes("area") || id.includes("width") || id.includes("wardrobe"))) {
    return "bedroom";
  }
  if (id.includes("living") && !id.includes("solar") && !id.includes("window") && !id.includes("outlook")) {
    return "living";
  }
  if (id.includes("storage") || id.includes("wardrobe") || id.includes("linen")) return "storage";
  if (id.includes("kitchen") || id.includes("laundry") || id.includes("bench")) return "kitchen";
  if (id.includes("bathroom")) return "bathroom";
  if (id.includes("internal_area") || id.includes("studio_min") || id.includes("accessible_apartment_min")) {
    return "apartment_size";
  }
  if (id.includes("window") || id.includes("daylight") || id.includes("snorkel")) return "habitable_window";
  if (id.includes("cross") || id.includes("ventilation") || id.includes("openable") || id.includes("aspect")) {
    return "dual_aspect";
  }
  switch (element) {
    case "solar_daylight_access":
      return "solar";
    case "natural_ventilation":
      return "ventilation";
    case "indoor_space":
      return "apartment_size";
    case "private_open_space":
      return "pos";
    case "communal_spaces":
      return "communal";
    case "circulation_spaces":
      return "circulation";
    case "acoustic_privacy":
      return "acoustic";
    case "outlook_visual_privacy":
      return "outlook";
    case "bicycle_car_parking":
      return "parking";
    case "apartment_mix":
      return "mix";
    default:
      return "generic";
  }
}

export function explainGuideline(guideline: PolicyGuideline, rule?: PolicyRule): PolicyExplain {
  if (rule) return explainPolicyRule(rule);
  if (guideline.mappedKind) {
    return explainPolicyRule({
      code: guideline.id,
      name: guideline.name,
      kind: guideline.mappedKind,
      minAreaM2: guideline.unit === "m2" ? guideline.value : undefined,
      minDimensionM: guideline.unit === "m" ? guideline.value : undefined,
      minCount: guideline.unit === "count" ? guideline.value : undefined,
      m2PerDwelling: guideline.unit === "m2_per_apartment" ? guideline.value : undefined,
      explanation: guideline.text,
      sourceText: guideline.sourceText,
    });
  }
  const threshold = formatHooperThreshold(guideline.operator, guideline.value, guideline.unit);
  const level = guideline.level ? `${guideline.level}-level` : "design";
  return {
    graphic: graphicForGuideline(guideline),
    summary: guideline.text,
    how: [
      guideline.mappedKind
        ? "This row maps to a plan check. Run Detect, set scale, and infer units, then Check compliance."
        : "HighLife cannot measure this variable on the plan yet. Use the description and graphic as a review checklist.",
      threshold ? `Stated test: ${threshold}${guideline.variable ? ` (${guideline.variable})` : ""}.` : "",
      `Applies at ${level}${guideline.policies?.length ? ` · ${guideline.policies.join(", ")}` : ""}.`,
    ].filter(Boolean),
  };
}
