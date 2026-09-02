import type { PolicyPack } from "@highlife/shared-types";
import { HOOPER_APARTMENT_RULES_V1 } from "./hooperApartmentRules";

export { HOOPER_APARTMENT_RULES_V1, HOOPER_PACK_ID } from "./hooperApartmentRules";

/** Internal starter pack — same rules as configs/policies/highlife_v1.yaml. */
export const HIGHLIFE_V1_PACK: PolicyPack = {
  id: "highlife_v1",
  version: "highlife_v1",
  name: "HighLife Design Policy v1",
  jurisdiction: "internal",
  description: "Deterministic starter rules for residential unit checks.",
  source: { kind: "builtin" },
  rules: [
    {
      code: "HL-ROOM-BED-MIN",
      name: "Minimum bedroom area",
      kind: "room_min_area",
      severity: "fail",
      requiresScale: true,
      roomLabels: ["Bedroom", "Bed"],
      minAreaM2: 9,
      explanation: "Bedroom area {measured} m² is below the {required} m² minimum.",
    },
    {
      code: "HL-ROOM-LIVING-MIN",
      name: "Minimum living area",
      kind: "room_min_area",
      severity: "fail",
      requiresScale: true,
      roomLabels: ["Living", "Living Room", "Lounge"],
      minAreaM2: 12,
      explanation: "Living area {measured} m² is below the {required} m² minimum.",
    },
    {
      code: "HL-ROOM-TYPES-REQUIRED",
      name: "Required room types present",
      kind: "required_labels",
      severity: "fail",
      requiredLabels: ["Bedroom", "Bathroom"],
      explanation: "Missing required room type(s): {missing}.",
    },
    {
      code: "HL-POS-MIN",
      name: "Private open space area",
      kind: "room_min_area",
      severity: "fail",
      requiresScale: true,
      roomLabels: ["Balcony", "Terrace", "Courtyard", "Private Open Space", "POS"],
      minAreaM2: 8,
      optionalIfAbsent: true,
      explanation: "Private open space {measured} m² is below the {required} m² minimum.",
    },
    {
      code: "HL-WALL-PRESENT",
      name: "Walls detected",
      kind: "min_wall_count",
      severity: "uncertain",
      minWallCount: 1,
      explanation: "No wall geometry in the scene graph — detection or review required.",
    },
  ],
};

/**
 * Victorian Better Apartments Design Standards (2017) + typical ADG dwelling
 * sizes. Numbers are the published minima used for apartment RDS checks.
 * Statutory approval stays with the assessor.
 */
export const RDS_VIC_APARTMENTS_V1: PolicyPack = {
  id: "rds_vic_apartments_v1",
  version: "rds_vic_apartments_v1",
  name: "Residential Design Standards — Apartments (VIC)",
  jurisdiction: "VIC",
  description:
    "Apartment rules from Better Apartments Design Standards (functional layout, private open space, storage, communal open space) and ADG dwelling-size bands. Evaluated against extracted apartments, not invented geometry.",
  source: { kind: "builtin" },
  rules: [
    {
      code: "RDS-APT-SIZE",
      name: "Minimum internal apartment area",
      kind: "apartment_min_internal",
      clause: "ADG 4D / BADS dwelling size",
      severity: "fail",
      requiresScale: true,
      byBedrooms: { "0": 35, "1": 50, "2": 70, "3": 90 },
      explanation: "{label}: internal {measured} m² is below {required} m² for a {beds}-bed dwelling.",
    },
    {
      code: "RDS-BED-MIN",
      name: "Minimum bedroom area",
      kind: "apartment_min_bedroom",
      clause: "BADS B24 / ADG 4E",
      severity: "fail",
      requiresScale: true,
      minAreaM2: 9,
      minDimensionM: 3,
      explanation: "{label} bedroom {measured} m² is below the {required} m² minimum.",
    },
    {
      code: "RDS-LIVING-MIN",
      name: "Minimum living area",
      kind: "apartment_min_living",
      clause: "BADS B24 / ADG 4D",
      severity: "fail",
      requiresScale: true,
      byBedrooms: { "0": 10, "1": 12, "2": 16, "3": 18 },
      minDimensionM: 3.3,
      explanation: "{label}: living {measured} m² is below {required} m² for a {beds}-bed dwelling.",
    },
    {
      code: "RDS-POS-MIN",
      name: "Private open space",
      kind: "apartment_min_pos",
      clause: "BADS B27",
      severity: "fail",
      requiresScale: true,
      byBedrooms: { "0": 8, "1": 8, "2": 8, "3": 8 },
      minDimensionM: 1.8,
      explanation: "{label}: private open space {measured} m² is below {required} m² (min dimension {dim} m).",
    },
    {
      code: "RDS-BATH-MIN",
      name: "Bathroom in each dwelling",
      kind: "apartment_min_bathrooms",
      clause: "BADS B24 functional layout",
      severity: "fail",
      minCount: 1,
      explanation: "{label}: dwelling has {measured} bathroom(s); {required} required.",
    },
    {
      code: "RDS-STORAGE",
      name: "In-dwelling storage",
      kind: "apartment_min_storage",
      clause: "BADS B30",
      severity: "fail",
      minCount: 1,
      explanation: "{label}: no dedicated store / robe space labelled on the plan.",
    },
    {
      code: "RDS-ASPECT-DUAL",
      name: "Natural ventilation / dual aspect",
      kind: "apartment_dual_aspect",
      clause: "BADS daylight and natural ventilation",
      severity: "fail",
      explanation: "{label}: windows are not on two sides (or north/window data is missing).",
    },
    {
      code: "RDS-HAB-WINDOW",
      name: "Habitable room has an exterior window",
      kind: "habitable_has_window",
      clause: "BADS daylight and natural ventilation",
      severity: "fail",
      explanation: "{label}: habitable rooms without an exterior window: {missing}.",
    },
    {
      code: "RDS-COMMUNAL",
      name: "Communal outdoor open space",
      kind: "communal_open_space",
      clause: "BADS B22",
      severity: "fail",
      requiresScale: true,
      m2PerDwelling: 2.5,
      explanation: "Communal outdoor space {measured} m² is below {required} m² ({per} m² × {dwellings} dwellings).",
    },
  ],
};

export const BUILTIN_POLICY_PACKS: PolicyPack[] = [HOOPER_APARTMENT_RULES_V1];

export function builtinPackById(id: string | null | undefined): PolicyPack | undefined {
  if (!id) return undefined;
  return BUILTIN_POLICY_PACKS.find((p) => p.id === id || p.version === id);
}
