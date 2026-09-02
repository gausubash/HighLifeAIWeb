import { describe, expect, it } from "vitest";
import { FPR_SPECIALISTS, trainableSpecialists } from "./specialistCatalog";

describe("specialistCatalog", () => {
  it("lists six CV specialists plus a VLM reasoner", () => {
    expect(FPR_SPECIALISTS).toHaveLength(8);
    expect(FPR_SPECIALISTS.filter((s) => !s.reasonerOnly)).toHaveLength(7);
    expect(FPR_SPECIALISTS.some((s) => s.role === "vlm" && s.reasonerOnly)).toBe(true);
    expect(trainableSpecialists().every((s) => s.studioCategory)).toBe(true);
  });
});
