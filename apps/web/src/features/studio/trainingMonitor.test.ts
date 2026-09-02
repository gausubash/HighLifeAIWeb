import { describe, expect, it } from "vitest";
import {
  historyEpochs,
  overfitHint,
  seriesFromHistory,
  trainingHints,
} from "./trainingMonitorMetrics";

describe("trainingMonitor", () => {
  it("builds epoch-aligned series and unique epochs", () => {
    const history = [
      { epoch: 1, "metrics/mAP50-95": 0.1, "train/seg_loss": 12 },
      { epoch: 2, "metrics/mAP50-95": 0.2, "train/seg_loss": 10 },
    ];
    expect(seriesFromHistory(history, ["map50-95"]).map((p) => p.epoch)).toEqual([1, 2]);
    expect(historyEpochs(history, [2, 5])).toEqual([1, 2, 5]);
  });

  it("flags high-recall / low-precision and mAP gap", () => {
    const hints = trainingHints({
      "metrics/precision(B)": 0.0033,
      "metrics/recall(B)": 1,
      "metrics/mAP50(B)": 0.995,
      "metrics/mAP50-95": 0.11,
    });
    expect(hints.some((h) => h.includes("false positives"))).toBe(true);
    expect(hints.some((h) => h.includes("mAP50-95"))).toBe(true);
  });

  it("flags a rising loss tail", () => {
    expect(
      overfitHint([
        { epoch: 1, value: 4 },
        { epoch: 2, value: 3.5 },
        { epoch: 3, value: 4.2 },
        { epoch: 4, value: 5 },
      ]),
    ).toMatch(/overfitting/i);
  });
});
