import { describe, expect, it } from "vitest";
import { findSelectedApartment, overlayIdsForReviewPick } from "./ReviewPanel";
import type { AnalysisResult } from "@highlife/shared-types";

function emptyResult(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    analysisId: "a",
    projectId: "p",
    sourceFileName: "plan.pdf",
    softwareCommit: "test",
    modelVersions: {},
    datasetVersion: "v1",
    createdAt: "",
    pages: [],
    units: [],
    spaces: [],
    openings: [],
    unitSummaries: [],
    complianceResults: [],
    reviewWarnings: [],
    policyVersion: "v1",
    status: "completed",
    currentStage: "completed",
    ...over,
  };
}

describe("overlayIdsForReviewPick", () => {
  it("returns the unit outline and its rooms", () => {
    const result = emptyResult({
      units: [
        {
          id: "u1",
          externalId: "U01",
          geometry: [],
          entranceIds: [],
          spaceIds: ["r1", "r2"],
          confidence: 1,
          reviewRequired: false,
        },
      ],
    });
    expect(overlayIdsForReviewPick(result, "U01")).toEqual(["u1", "r1", "r2"]);
  });
});

describe("findSelectedApartment", () => {
  const apartments = [
    { unitId: "u1", label: "101", evidenceIds: ["u1", "r1"] },
    { unitId: "u2", label: "102", evidenceIds: ["u2", "r2"] },
  ];

  it("returns null when nothing is selected", () => {
    expect(findSelectedApartment(apartments, null)).toBeNull();
  });

  it("matches by unit id, label, or evidence", () => {
    expect(findSelectedApartment(apartments, "u2")?.label).toBe("102");
    expect(findSelectedApartment(apartments, "101")?.unitId).toBe("u1");
    expect(findSelectedApartment(apartments, "r2")?.label).toBe("102");
  });
});
