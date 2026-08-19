export * from "./analysis";
export * from "./project";
export * from "./geometry";
export * from "./compliance";

import type { AnalysisStage, AnalysisStatus } from "./analysis";
import type { ComplianceResult, ReviewWarning, UnitSummary } from "./compliance";
import type { Opening, PlanPage, Space, Unit } from "./geometry";

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
  complianceResults: ComplianceResult[];
  unitSummaries: UnitSummary[];
  reviewWarnings: ReviewWarning[];
  status: AnalysisStatus;
  currentStage: AnalysisStage;
}
