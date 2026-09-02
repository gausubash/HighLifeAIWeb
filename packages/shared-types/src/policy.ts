/** Machine-readable residential design policy pack (RDS / BADS / ADG). */

export type PolicyRuleKind =
  | "room_min_area"
  | "required_labels"
  | "min_wall_count"
  | "apartment_min_internal"
  | "apartment_min_living"
  | "apartment_min_pos"
  | "apartment_min_bedroom"
  | "apartment_min_bathrooms"
  | "apartment_min_storage"
  | "apartment_dual_aspect"
  | "habitable_has_window"
  | "communal_open_space";

export type PolicySeverity = "fail" | "uncertain" | "info";

export type PolicySourceKind = "builtin" | "json" | "yaml" | "pdf" | "llm";

/** Bedroom-count bands: 0 = studio, 3 = three or more. */
export type BedroomBand = "0" | "1" | "2" | "3";

export type PolicyGuidelineStatus = "pending" | "accepted" | "rejected";

export interface PolicySourceRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PolicyGuideline {
  id: string;
  group: string;
  name: string;
  text: string;
  clause?: string;
  sourceText?: string;
  page?: number;
  lineIds?: string[];
  rects?: PolicySourceRect[];
  status: PolicyGuidelineStatus;
  mappedKind?: PolicyRuleKind | null;
  /** Hooper / MethodsX design-element key, e.g. indoor_space. */
  designElement?: string;
  level?: "apartment" | "building" | "floor" | string;
  policies?: string[];
  variable?: string;
  operator?: string;
  value?: number;
  unit?: string;
}

export interface PolicySourcePage {
  pageNumber: number;
  width: number;
  height: number;
}

export interface PolicyRule {
  code: string;
  name: string;
  kind: PolicyRuleKind;
  guidelineId?: string;
  clause?: string;
  severity?: PolicySeverity;
  requiresScale?: boolean;
  explanation?: string;
  sourceText?: string;
  roomLabels?: string[];
  minAreaM2?: number;
  optionalIfAbsent?: boolean;
  requiredLabels?: string[];
  minWallCount?: number;
  /** Thresholds keyed by bedroom band (studio / 1 / 2 / 3+). */
  byBedrooms?: Partial<Record<BedroomBand, number>>;
  minDimensionM?: number;
  minCount?: number;
  minCommunalM2?: number;
  m2PerDwelling?: number;
}

export interface PolicyPack {
  id: string;
  version: string;
  name: string;
  jurisdiction?: string;
  description?: string;
  source?: { kind: PolicySourceKind; fileName?: string };
  notes?: string[];
  rules: PolicyRule[];
  guidelines?: PolicyGuideline[];
  sourcePages?: PolicySourcePage[];
  createdAt?: string;
}
