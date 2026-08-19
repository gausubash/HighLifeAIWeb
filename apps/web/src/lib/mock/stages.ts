import {
  ANALYSIS_STAGES,
  type Analysis,
  type AnalysisStage,
} from "@highlife/shared-types";

/** Stages simulated during mock processing (excludes terminal states) */
export const PROCESSING_STAGES: AnalysisStage[] = ANALYSIS_STAGES.filter(
  (s) => s !== "failed" && s !== "completed" && s !== "uploaded"
);

export function stageProgress(stage: AnalysisStage): number {
  const index = PROCESSING_STAGES.indexOf(stage);
  if (index === -1) {
    if (stage === "completed") return 100;
    return 0;
  }
  return Math.round(((index + 1) / PROCESSING_STAGES.length) * 100);
}

export function isTerminalStatus(analysis: Analysis): boolean {
  return (
    analysis.status === "completed" ||
    analysis.status === "failed" ||
    analysis.status === "review_required" ||
    analysis.status === "cancelled"
  );
}

export function nextStage(current: AnalysisStage): AnalysisStage {
  const index = PROCESSING_STAGES.indexOf(current);
  if (index === -1 || index >= PROCESSING_STAGES.length - 1) {
    return "review_required";
  }
  return PROCESSING_STAGES[index + 1];
}
