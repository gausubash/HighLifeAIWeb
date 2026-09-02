import { describe, expect, it } from "vitest";
import { applyOcrResolution, ocrResolutionForCrop } from "./ocrResolution";

describe("ocrResolutionForCrop", () => {
  it("upsamples a small title block toward 960 and caps a large one", () => {
    expect(ocrResolutionForCrop({ kind: "title_block", widthPx: 420, heightPx: 180 })).toEqual({
      detLimitSideLen: 736,
      vlMaxSide: 1024,
    });
    expect(ocrResolutionForCrop({ kind: "title_block", widthPx: 1100, heightPx: 400 }).detLimitSideLen).toBe(
      1280,
    );
    expect(ocrResolutionForCrop({ kind: "title_block", widthPx: 2400, heightPx: 800 }).detLimitSideLen).toBe(
      1280,
    );
  });

  it("keeps more pixels on a large drawing than a title crop", () => {
    expect(ocrResolutionForCrop({ kind: "drawing", widthPx: 800, heightPx: 600 }).detLimitSideLen).toBe(960);
    expect(ocrResolutionForCrop({ kind: "drawing", widthPx: 1800, heightPx: 1400 }).detLimitSideLen).toBe(2048);
    expect(ocrResolutionForCrop({ kind: "drawing", widthPx: 5000, heightPx: 3500 }).detLimitSideLen).toBe(4096);
  });
});

describe("applyOcrResolution", () => {
  it("fills Auto from the crop and keeps a manual det limit", () => {
    expect(
      applyOcrResolution({}, "drawing", 1800, 1400).detLimitSideLen,
    ).toBe(2048);
    expect(
      applyOcrResolution({ detLimitSideLen: 960 }, "drawing", 1800, 1400).detLimitSideLen,
    ).toBe(960);
    expect(
      applyOcrResolution({ useDocOrientationClassify: true, useDocUnwarping: true }, "drawing", 1800, 1400),
    ).toMatchObject({
      useDocOrientationClassify: false,
      useDocUnwarping: false,
    });
  });
});
