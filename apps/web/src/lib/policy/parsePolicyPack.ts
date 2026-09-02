import type {
  PolicyGuideline,
  PolicyGuidelineStatus,
  PolicyPack,
  PolicyRule,
  PolicyRuleKind,
  PolicySourceRect,
} from "@highlife/shared-types";
import { isHooperApartmentRulesDoc, packFromHooperApartmentRules } from "./hooperApartmentRules";

const KINDS = new Set<PolicyRuleKind>([
  "room_min_area",
  "required_labels",
  "min_wall_count",
  "apartment_min_internal",
  "apartment_min_living",
  "apartment_min_pos",
  "apartment_min_bedroom",
  "apartment_min_bathrooms",
  "apartment_min_storage",
  "apartment_dual_aspect",
  "habitable_has_window",
  "communal_open_space",
]);

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function asNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.map((item) => asString(item)).filter(Boolean);
  return out.length ? out : undefined;
}

function inferKind(raw: Record<string, unknown>): PolicyRuleKind {
  const explicit = asString(raw.kind);
  if (KINDS.has(explicit as PolicyRuleKind)) return explicit as PolicyRuleKind;
  if (raw.required_labels || raw.requiredLabels) return "required_labels";
  if (raw.min_wall_count != null || raw.minWallCount != null) return "min_wall_count";
  if (raw.m2_per_dwelling != null || raw.m2PerDwelling != null || raw.minCommunalM2 != null) {
    return "communal_open_space";
  }
  if (raw.by_bedrooms || raw.byBedrooms) {
    const name = asString(raw.name).toLowerCase() + asString(raw.code).toLowerCase();
    if (name.includes("living")) return "apartment_min_living";
    if (name.includes("pos") || name.includes("open space") || name.includes("balcony")) {
      return "apartment_min_pos";
    }
    return "apartment_min_internal";
  }
  return "room_min_area";
}

function asByBedrooms(value: unknown): PolicyRule["byBedrooms"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  const out: NonNullable<PolicyRule["byBedrooms"]> = {};
  for (const key of ["0", "1", "2", "3"] as const) {
    const n = asNumber(rec[key] ?? rec[key === "3" ? "3+" : key]);
    if (n != null) out[key] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

export function normalizePolicyRule(raw: unknown, index: number): PolicyRule | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const code = asString(row.code) || `RULE-${index + 1}`;
  const name = asString(row.name) || code;
  return {
    code,
    name,
    kind: inferKind(row),
    guidelineId: asString(row.guideline_id ?? row.guidelineId) || undefined,
    clause: asString(row.clause) || undefined,
    severity: asString(row.severity) === "uncertain" || asString(row.severity) === "info"
      ? (asString(row.severity) as PolicyRule["severity"])
      : "fail",
    requiresScale: Boolean(row.requires_scale ?? row.requiresScale),
    explanation: asString(row.explanation) || undefined,
    sourceText: asString(row.source_text ?? row.sourceText) || undefined,
    roomLabels: asStringList(row.room_labels ?? row.roomLabels),
    minAreaM2: asNumber(row.min_area_m2 ?? row.minAreaM2),
    optionalIfAbsent: Boolean(row.optional_if_absent ?? row.optionalIfAbsent),
    requiredLabels: asStringList(row.required_labels ?? row.requiredLabels),
    minWallCount: asNumber(row.min_wall_count ?? row.minWallCount),
    byBedrooms: asByBedrooms(row.by_bedrooms ?? row.byBedrooms),
    minDimensionM: asNumber(row.min_dimension_m ?? row.minDimensionM),
    minCount: asNumber(row.min_count ?? row.minCount),
    minCommunalM2: asNumber(row.min_communal_m2 ?? row.minCommunalM2),
    m2PerDwelling: asNumber(row.m2_per_dwelling ?? row.m2PerDwelling),
  };
}

function asStatus(value: unknown): PolicyGuidelineStatus {
  const s = asString(value);
  if (s === "accepted" || s === "rejected") return s;
  return "pending";
}

function asRects(value: unknown): PolicySourceRect[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: PolicySourceRect[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const page = asNumber(row.page);
    const x = asNumber(row.x);
    const y = asNumber(row.y);
    const width = asNumber(row.width);
    const height = asNumber(row.height);
    if (page == null || x == null || y == null || width == null || height == null) continue;
    out.push({ page, x, y, width, height });
  }
  return out.length ? out : undefined;
}

function mappedKindOf(raw: Record<string, unknown>): PolicyRuleKind | null | undefined {
  const explicit = asString(raw.mapped_kind ?? raw.mappedKind);
  if (!explicit) return undefined;
  return KINDS.has(explicit as PolicyRuleKind) ? (explicit as PolicyRuleKind) : null;
}

export function normalizeGuideline(raw: unknown, index: number): PolicyGuideline | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const text = asString(row.text ?? row.source_text ?? row.sourceText);
  const name = asString(row.name) || (text ? text.slice(0, 72) : "");
  if (!name && !text) return null;
  const mapped = mappedKindOf(row);
  return {
    id: asString(row.id) || `g-${index + 1}`,
    group: asString(row.group ?? row.section) || "General",
    name: name || `Guideline ${index + 1}`,
    text: text || name,
    clause: asString(row.clause) || undefined,
    sourceText: asString(row.source_text ?? row.sourceText) || undefined,
    page: asNumber(row.page),
    lineIds: asStringList(row.line_ids ?? row.lineIds),
    rects: asRects(row.rects),
    status: asStatus(row.status),
    mappedKind: mapped === undefined ? undefined : mapped,
    designElement: asString(row.design_element ?? row.designElement) || undefined,
    level: asString(row.level) || undefined,
    policies: asStringList(row.policies ?? row.policy),
    variable: asString(row.variable) || undefined,
    operator: asString(row.operator) || undefined,
    value: asNumber(row.value),
    unit: asString(row.unit) || undefined,
  };
}

function guidelinesFromGroups(groups: unknown): PolicyGuideline[] {
  if (!Array.isArray(groups)) return [];
  const out: PolicyGuideline[] = [];
  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const rec = group as Record<string, unknown>;
    const title = asString(rec.title ?? rec.name ?? rec.group) || "General";
    const items = Array.isArray(rec.guidelines) ? rec.guidelines : Array.isArray(rec.items) ? rec.items : [];
    for (const item of items) {
      const g = normalizeGuideline(
        item && typeof item === "object" ? { ...(item as object), group: title } : item,
        out.length,
      );
      if (g) out.push({ ...g, group: title });
    }
  }
  return out;
}

function rulesFromGuidelines(guidelines: PolicyGuideline[], existing: PolicyRule[]): PolicyRule[] {
  if (existing.length) {
    return existing.map((rule) => {
      if (rule.guidelineId) return rule;
      const match = guidelines.find(
        (g) => g.mappedKind === rule.kind && (g.sourceText === rule.sourceText || g.name === rule.name),
      );
      return match ? { ...rule, guidelineId: match.id } : rule;
    });
  }
  return guidelines
    .filter((g) => g.mappedKind)
    .map((g, i) =>
      normalizePolicyRule(
        {
          code: g.clause || g.id.toUpperCase(),
          name: g.name,
          kind: g.mappedKind,
          guidelineId: g.id,
          clause: g.clause,
          sourceText: g.sourceText ?? g.text.slice(0, 240),
          requiresScale: g.mappedKind !== "apartment_dual_aspect" && g.mappedKind !== "habitable_has_window",
        },
        i,
      ),
    )
    .filter((rule): rule is PolicyRule => rule != null);
}

export function parsePolicyPack(raw: unknown, fileName?: string): PolicyPack {
  if (isHooperApartmentRulesDoc(raw)) {
    return packFromHooperApartmentRules(raw, { fileName });
  }
  const doc = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rulesIn = Array.isArray(doc.rules) ? doc.rules : [];
  let rules = rulesIn
    .map((rule, i) => normalizePolicyRule(rule, i))
    .filter((rule): rule is PolicyRule => rule != null);
  const fromFlat = Array.isArray(doc.guidelines)
    ? doc.guidelines.map((g, i) => normalizeGuideline(g, i)).filter((g): g is PolicyGuideline => g != null)
    : [];
  const guidelines = fromFlat.length ? fromFlat : guidelinesFromGroups(doc.groups);
  if (guidelines.length) {
    rules = rulesFromGuidelines(guidelines, rules);
  }
  if (!rules.length && !guidelines.length) {
    throw new Error("Policy file has no guidelines or rules. Use a policy PDF, or JSON with a rules array.");
  }
  const version = asString(doc.version) || asString(doc.id) || `upload-${Date.now()}`;
  const id = asString(doc.id) || version;
  return {
    id,
    version,
    name: asString(doc.name) || fileName?.replace(/\.[^.]+$/, "") || "Uploaded policy",
    jurisdiction: asString(doc.jurisdiction) || undefined,
    description: asString(doc.description) || undefined,
    source: {
      kind: fileName?.toLowerCase().endsWith(".pdf") ? "pdf" : "json",
      fileName,
    },
    notes: asStringList(doc.notes),
    rules,
    guidelines: guidelines.length ? guidelines : undefined,
    createdAt: new Date().toISOString(),
  };
}

export function parsePolicyJsonText(text: string, fileName?: string): PolicyPack {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty policy file.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Could not parse JSON. Export the pack as .json or upload the PDF for conversion.");
  }
  return parsePolicyPack(parsed, fileName);
}
