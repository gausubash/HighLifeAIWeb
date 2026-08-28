export * from "./analysis";
export * from "./project";
export * from "./geometry";
export * from "./compliance";
export * from "./scene-graph";
export * from "./hierarchy";

import type { AnalysisStage, AnalysisStatus } from "./analysis";
import type { ComplianceResult, ReviewWarning, UnitSummary } from "./compliance";
import type { Opening, PlanPage, Space, Unit } from "./geometry";
import type { BuildingHierarchy } from "./hierarchy";

/** Full analysis result payload (result.json schema) */
export interface AnalysisResult {
  analysisId: string;
  projectId: string;
  sourceFileName: string;
  softwareCommit: string;
  modelVersions: Record<string, string>;
  policyVersion: string;
  datasetVersion: string;
  createdAt: string;
  pages: PlanPage[];
  spaces: Space[];
  openings: Opening[];
  units: Unit[];
  /** Building → floor → unit → room tree derived from pages + detections. */
  hierarchy?: BuildingHierarchy;
  complianceResults: ComplianceResult[];
  unitSummaries: UnitSummary[];
  reviewWarnings: ReviewWarning[];
  status: AnalysisStatus;
  currentStage: AnalysisStage;
}
