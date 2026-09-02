import { describe, expect, it } from "vitest";
import { materializeOcrLines, removeOcrLineAt } from "./removeOcrLine";

describe("removeOcrLineAt", () => {
  it("removes a line by index and updates textHint", () => {
    const meta = {
      provider: "paddleocr",
      confidence: 0.9,
      lines: [
        { text: "KITCHEN", confidence: 0.92, bbox: [[0, 0], [10, 0], [10, 5], [0, 5]] },
        { text: "BED 1", confidence: 0.88, bbox: [[20, 0], [30, 0], [30, 5], [20, 5]] },
      ],
      textHint: "KITCHEN\nBED 1",
      ocrLineCount: 2,
    };

    const next = removeOcrLineAt(meta, 0);
    expect(next?.lines).toHaveLength(1);
    expect(next?.lines?.[0].text).toBe("BED 1");
    expect(next?.textHint).toBe("BED 1");
    expect(next?.ocrLineCount).toBe(1);
  });

  it("materializes textHint-only meta before removing", () => {
    const meta = {
      provider: "pdf-text",
      confidence: 1,
      textHint: "Scale 1:100\nLevel 2",
    };
    expect(materializeOcrLines(meta)).toHaveLength(2);
    const next = removeOcrLineAt(meta, 1);
    expect(next?.textHint).toBe("Scale 1:100");
  });
});
