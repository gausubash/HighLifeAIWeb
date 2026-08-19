import { describe, expect, it } from "vitest";
import { nextStage, stageProgress } from "@/lib/mock/stages";

describe("analysis stage progression", () => {
  it("calculates progress for known stages", () => {
    expect(stageProgress("rendering_pdf")).toBeGreaterThan(0);
    expect(stageProgress("review_required")).toBe(100);
  });

  it("advances to next stage in order", () => {
    expect(nextStage("rendering_pdf")).toBe("identifying_floor_plan_pages");
    expect(nextStage("generating_outputs")).toBe("review_required");
  });
});
