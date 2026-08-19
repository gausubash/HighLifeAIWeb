export type ComplianceResultCategory =
  | "pass"
  | "fail"
  | "uncertain"
  | "not_applicable"
  | "not_implemented";

export interface ComplianceResult {
  id: string;
  analysisId: string;
  unitExternalId: string;
  ruleCode: string;
  policyVersion: string;
  result: ComplianceResultCategory;
  measuredValue?: number;
  requiredValue?: number;
  unit?: string;
  explanation: string;
  evidence?: Record<string, unknown>;
  confidence: number;
  createdAt: string;
}

export interface UnitSummary {
  unitId: string;
  areaM2: number;
  roomCount: number;
  bedroomCount: number;
  bathroomCount: number;
  privateOpenSpaceAreaM2: number;
  confidence: number;
  reviewStatus: "ok" | "review_required";
}

export interface ReviewWarning {
  code: string;
  message: string;
  objectId?: string;
  objectType?: string;
  severity: "info" | "warning" | "error";
}
