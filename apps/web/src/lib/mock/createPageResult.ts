import type { AnalysisResult, PlanPage } from "@highlife/shared-types";
import type { ScaleInfo } from "@/lib/scale/parseScale";

export type PageRenderInput = {
  pageNumber: number;
  imageDataUrl: string;
  widthPx: number;
  heightPx: number;
  graphicsKind?: PlanPage["graphicsKind"];
  graphicsSummary?: string;
};

export function createPageOnlyResult(args: {
  analysisId: string;
  projectId: string;
  fileName: string;
  pages: PageRenderInput[];
  /** Scale seeded from page 1 text / calibration. */
  scaleInfo: ScaleInfo;
}): AnalysisResult {
  const { analysisId, projectId, fileName, pages: rendered, scaleInfo } = args;

  const scaleMPerPixel =
    scaleInfo.pixelsPerMeter && scaleInfo.pixelsPerMeter > 0
      ? 1 / scaleInfo.pixelsPerMeter
      : undefined;

  const pages: PlanPage[] = rendered.map((p) => ({
    id: `page-${String(p.pageNumber).padStart(3, "0")}`,
    pageNumber: p.pageNumber,
    imagePath: p.imageDataUrl,
    widthPx: p.widthPx,
    heightPx: p.heightPx,
    isFloorPlan: true,
    scaleMPerPixel,
    scaleSource: scaleInfo.method,
    scaleConfidence: scaleInfo.confidence,
    graphicsKind: p.graphicsKind,
    graphicsSummary: p.graphicsSummary,
    sourceFileName: fileName,
    levelName: `Floor ${p.pageNumber}`,
    levelIndex: p.pageNumber - 1,
    floorId: `floor-page-${String(p.pageNumber).padStart(3, "0")}`,
  }));

  return {
    analysisId,
    projectId,
    sourceFileName: fileName,
    softwareCommit: "local",
    modelVersions: {},
    policyVersion: "draft-v1",
    datasetVersion: "n/a",
    createdAt: new Date().toISOString(),
    status: "completed",
    currentStage: "completed",
    pages,
    spaces: [],
    openings: [],
    units: [],
    complianceResults: [],
    unitSummaries: [],
    reviewWarnings: [],
  };
}
