/** Analysis job lifecycle statuses */
export type AnalysisStatus =
  | "queued"
  | "processing"
  | "review_required"
  | "completed"
  | "failed"
  | "cancelled";

/** Pipeline stage identifiers */
export type AnalysisStage =
  | "uploaded"
  | "queued"
  | "rendering_pdf"
  | "identifying_floor_plan_pages"
  | "preprocessing"
  | "running_structural_models"
  | "running_ocr"
  | "reconstructing_geometry"
  | "inferring_corridors"
  | "inferring_units"
  | "calculating_measurements"
  | "running_policy_checks"
  | "generating_outputs"
  | "review_required"
  | "completed"
  | "failed";

export interface Analysis {
  id: string;
  projectId: string;
  ownerId: string;
  sourceFileName: string;
  status: AnalysisStatus;
  progress: number;
  currentStage: AnalysisStage;
  errorMessage?: string;
  modelVersions?: Record<string, string>;
  softwareCommit?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  /** Summary counts populated after processing */
  pageCount?: number;
  unitCount?: number;
  reviewCount?: number;
  /** Private Storage folder: `{userId}/{projectId}/{analysisId}` */
  storagePath?: string;
}

export const ANALYSIS_STAGES: AnalysisStage[] = [
  "uploaded",
  "queued",
  "rendering_pdf",
  "identifying_floor_plan_pages",
  "preprocessing",
  "running_structural_models",
  "running_ocr",
  "reconstructing_geometry",
  "inferring_corridors",
  "inferring_units",
  "calculating_measurements",
  "running_policy_checks",
  "generating_outputs",
  "review_required",
  "completed",
  "failed",
];

export const STAGE_LABELS: Record<AnalysisStage, string> = {
  uploaded: "Uploaded",
  queued: "Queued",
  rendering_pdf: "Rendering PDF",
  identifying_floor_plan_pages: "Identifying floor-plan pages",
  preprocessing: "Preprocessing",
  running_structural_models: "Running structural models",
  running_ocr: "Running OCR",
  reconstructing_geometry: "Reconstructing geometry",
  inferring_corridors: "Inferring corridors",
  inferring_units: "Inferring units",
  calculating_measurements: "Calculating measurements",
  running_policy_checks: "Running policy checks",
  generating_outputs: "Generating outputs",
  review_required: "Review required",
  completed: "Completed",
  failed: "Failed",
};
