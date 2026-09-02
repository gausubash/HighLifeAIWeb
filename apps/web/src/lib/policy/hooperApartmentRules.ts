import type {
  PolicyGuideline,
  PolicyGuidelineStatus,
  PolicyPack,
  PolicyRule,
  PolicyRuleKind,
} from "@highlife/shared-types";
import source from "./data/apartment_rules_complete.json";

export const HOOPER_PACK_ID = "hooper_apartment_rules_v1";

export type HooperApartmentRule = {
  id: string;
  design_element: string;
  description: string;
  policy?: string[];
  level?: string;
  variable?: string;
  operator?: string;
  value?: number;
  unit?: string;
};

type HooperDoc = {
  metadata?: { source?: string; description?: string; total_rules?: number; note?: string };
  rules?: HooperApartmentRule[];
};

const GROUP_LABEL: Record<string, string> = {
  solar_daylight_access: "Solar & daylight",
  natural_ventilation: "Natural ventilation",
  indoor_space: "Indoor space",
  private_open_space: "Private open space",
  communal_spaces: "Communal spaces",
  circulation_spaces: "Circulation",
  acoustic_privacy: "Acoustic privacy",
  outlook_visual_privacy: "Outlook & visual privacy",
  bicycle_car_parking: "Bicycle & car parking",
  apartment_mix: "Apartment mix",
};

const GROUP_ORDER = Object.keys(GROUP_LABEL);

type CanonicalMap = {
  kind: PolicyRuleKind;
  extra?: Partial<PolicyRule>;
};

/** Plan-checkable subset. Sibling Hooper rows stay visible as guidelines. */
const CANONICAL: Record<string, CanonicalMap> = {
  habitable_rooms_window: { kind: "habitable_has_window" },
  ventilation_opposite_facades: { kind: "apartment_dual_aspect" },
  studio_min_35m2: {
    kind: "apartment_min_internal",
    extra: {
      byBedrooms: { "0": 35, "1": 50, "2": 70, "3": 90 },
      requiresScale: true,
      explanation: "{label}: internal {measured} m² is below {required} m² for a {beds}-bed dwelling.",
    },
  },
  living_room_min_16m2: {
    kind: "apartment_min_living",
    extra: {
      minAreaM2: 16,
      minDimensionM: 3.6,
      requiresScale: true,
      explanation: "{label}: living {measured} m² is below {required} m².",
    },
  },
  other_bedroom_min_9m2: {
    kind: "apartment_min_bedroom",
    extra: {
      minAreaM2: 9,
      minDimensionM: 3,
      requiresScale: true,
      explanation: "{label} bedroom {measured} m² is below the {required} m² minimum.",
    },
  },
  balcony_1bed_min_8m2: {
    kind: "apartment_min_pos",
    extra: {
      byBedrooms: { "0": 4, "1": 8, "2": 10, "3": 12 },
      minDimensionM: 2,
      requiresScale: true,
      explanation: "{label}: private open space {measured} m² is below {required} m² (min dimension {dim} m).",
    },
  },
  communal_open_space_min_25m2_per_apt: {
    kind: "communal_open_space",
    extra: {
      m2PerDwelling: 25,
      requiresScale: true,
      explanation: "Communal outdoor space {measured} m² is below {required} m² ({per} m² × {dwellings} dwellings).",
    },
  },
  storage_1bed_min_6m3: {
    kind: "apartment_min_storage",
    extra: {
      minCount: 1,
      explanation: "{label}: no dedicated store / robe space labelled on the plan.",
    },
  },
};

export function hooperGroupLabel(element: string): string {
  return GROUP_LABEL[element] ?? element.replace(/_/g, " ");
}

export function isHooperApartmentRulesDoc(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const rules = (raw as HooperDoc).rules;
  if (!Array.isArray(rules) || rules.length === 0) return false;
  const first = rules[0];
  return Boolean(
    first &&
      typeof first === "object" &&
      "design_element" in first &&
      "variable" in first &&
      !("kind" in first),
  );
}

export function titleFromHooperId(id: string): string {
  return id
    .replace(/(\d+)_(\d+)m2\b/g, "$1.$2 m²")
    .replace(/(\d+)m2\b/g, "$1 m²")
    .replace(/(\d+)_(\d+)m3\b/g, "$1.$2 m³")
    .replace(/(\d+)m3\b/g, "$1 m³")
    .replace(/(\d+)_(\d+)m\b/g, "$1.$2 m")
    .replace(/(\d+)m\b/g, "$1 m")
    .replace(/(\d+)pct\b/g, "$1%")
    .replace(/(\d+)h\b/g, "$1 h")
    .replace(/1bed/g, "1-bed")
    .replace(/2bed/g, "2-bed")
    .replace(/3bed/g, "3-bed")
    .replace(/4bed/g, "4-bed")
    .replace(/2plus/g, "2+")
    .replace(/_rw_/g, "_Rw_")
    .replace(/_ln_/g, "_Ln_")
    .replace(/_bads\b/g, "_BADS")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatHooperThreshold(operator?: string, value?: number, unit?: string): string {
  if (value == null && !operator) return "";
  const op = operator && operator !== "==" ? `${operator} ` : "";
  if (unit === "boolean") return value === 1 ? "Required" : "Not required";
  if (unit === "fraction" && value != null) return `${op}${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
  if (unit === "ratio" && value != null) return `${op}${(value * 100).toFixed(0)}%`;
  const unitLabel =
    unit === "m2"
      ? "m²"
      : unit === "m3"
        ? "m³"
        : unit === "m2_per_apartment"
          ? "m² / apartment"
          : unit?.replace(/_/g, " ") || "";
  return `${op}${value ?? ""}${unitLabel ? ` ${unitLabel}` : ""}`.trim();
}

function asHooperRules(raw: unknown): HooperApartmentRule[] {
  const rules = (raw as HooperDoc)?.rules;
  if (!Array.isArray(rules)) return [];
  return rules.filter((row): row is HooperApartmentRule => Boolean(row && typeof row === "object" && row.id));
}

export function packFromHooperApartmentRules(
  raw: unknown,
  opts?: { fileName?: string; defaultStatus?: PolicyGuidelineStatus; builtin?: boolean },
): PolicyPack {
  const rows = asHooperRules(raw);
  if (!rows.length) throw new Error("Hooper apartment rules file has no rules.");
  const status = opts?.defaultStatus ?? (opts?.builtin ? "accepted" : "pending");
  const sorted = [...rows].sort((a, b) => {
    const ga = GROUP_ORDER.indexOf(a.design_element);
    const gb = GROUP_ORDER.indexOf(b.design_element);
    return (ga === -1 ? 99 : ga) - (gb === -1 ? 99 : gb) || a.id.localeCompare(b.id);
  });

  const guidelines: PolicyGuideline[] = sorted.map((row) => {
    const mapped = CANONICAL[row.id];
    const policies = (row.policy ?? []).filter(Boolean);
    return {
      id: row.id,
      group: hooperGroupLabel(row.design_element),
      name: titleFromHooperId(row.id),
      text: row.description,
      clause: [...policies, row.level].filter(Boolean).join(" · ") || undefined,
      sourceText: row.description,
      status,
      mappedKind: mapped?.kind ?? null,
      designElement: row.design_element,
      level: row.level,
      policies,
      variable: row.variable,
      operator: row.operator,
      value: typeof row.value === "number" ? row.value : undefined,
      unit: row.unit,
    };
  });

  const rules: PolicyRule[] = guidelines
    .filter((g) => g.mappedKind)
    .map((g) => {
      const extra = CANONICAL[g.id]?.extra ?? {};
      return {
        code: g.id.toUpperCase().replace(/-/g, "_"),
        name: g.name,
        kind: g.mappedKind!,
        guidelineId: g.id,
        clause: g.clause,
        severity: "fail" as const,
        requiresScale: extra.requiresScale ?? false,
        explanation: extra.explanation,
        sourceText: g.text,
        ...extra,
      };
    });

  const mappedCount = rules.length;
  return {
    id: opts?.builtin ? HOOPER_PACK_ID : opts?.fileName?.replace(/\.[^.]+$/, "") || HOOPER_PACK_ID,
    version: HOOPER_PACK_ID,
    name: "Apartment design rules (Hooper 2022)",
    jurisdiction: "SEPP65 / SPP7.3 / BADS",
    description:
      "Complete apartment rules from Hooper et al. 2022, MethodsX Table 1 — a synthesis of SEPP65/ADG (NSW), SPP7.3 (WA), and BADS (VIC). All 122 rows are listed; plan checks run on the mapped subset.",
    source: { kind: opts?.builtin ? "builtin" : "json", fileName: opts?.fileName },
    notes: [
      `Source: Hooper et al. 2022, MethodsX Table 1 · ${guidelines.length} rules.`,
      `${mappedCount} can be checked on the plan today. The rest stay as design guidelines until HighLife can measure that variable.`,
    ],
    rules,
    guidelines,
    createdAt: opts?.builtin ? "2026-09-02T00:00:00.000Z" : new Date().toISOString(),
  };
}

export const HOOPER_APARTMENT_RULES_V1: PolicyPack = packFromHooperApartmentRules(source, {
  builtin: true,
  defaultStatus: "accepted",
});
