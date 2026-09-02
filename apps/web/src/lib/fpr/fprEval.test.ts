import { describe, expect, it } from "vitest";
import { bearingErrorDeg, formatEvalCsv, panopticQuality, relativeError } from "./fprEval";

describe("fprEval", () => {
  it("computes PQ for a perfect match", () => {
    const box = { x: 0, y: 0, width: 10, height: 10 };
    const pq = panopticQuality([box], [box]);
    expect(pq.pq).toBeCloseTo(1);
    expect(pq.fp).toBe(0);
  });

  it("reports relative and bearing error", () => {
    expect(relativeError(10, 12)).toBeCloseTo(0.2);
    expect(relativeError(10, null)).toBe(1);
    expect(bearingErrorDeg(0, 350)).toBeCloseTo(10);
  });

  it("writes a journal CSV header", () => {
    const csv = formatEvalCsv([
      {
        sheetId: "s1",
        unitPq: 0.8,
        roomPq: 0.7,
        openingAp: 0.6,
        areaRelError: 0.05,
        openingRelError: 0.1,
        bearingAbsErrorDeg: 8,
        ablation: "no-overlap",
      },
    ]);
    expect(csv).toContain("unitPq");
    expect(csv).toContain("s1");
  });
});
