import { describe, expect, it } from "vitest";
import type { PlanPage } from "@highlife/shared-types";
import {
  applyOcrLevelToPage,
  levelIndexFromName,
  parseLevelName,
  parseUnitIds,
  pickLevelFromLines,
  pickLevelFromOcrMeta,
  pickUnitIdsFromPage,
  resolveBuildingName,
  resolveFloorPageMeta,
  resolvePageLevelName,
  isPlaceholderFloorLabel,
} from "./pageLevel";

describe("parseLevelName", () => {
  it("parses level numbers and ground floor", () => {
    expect(parseLevelName("TOWER A LEVEL 02")).toBe("Level 02");
    expect(parseLevelName("GROUND FLOOR PLAN")).toBe("Ground Floor Plan");
  });

  it("parses ordinal floor plans", () => {
    expect(parseLevelName("FIRST FLOOR PLAN")).toBe("First Floor Plan");
    expect(parseLevelName("Second Floor Plan")).toBe("Second Floor Plan");
    expect(parseLevelName("3rd Floor")).toBe("Third Floor");
  });
});

describe("levelIndexFromName", () => {
  it("orders common storey labels", () => {
    expect(levelIndexFromName("Basement")).toBe(-1);
    expect(levelIndexFromName("Ground Floor")).toBe(0);
    expect(levelIndexFromName("First Floor")).toBe(1);
    expect(levelIndexFromName("First Floor Plan")).toBe(1);
    expect(levelIndexFromName("Second Floor")).toBe(2);
    expect(levelIndexFromName("Level 03")).toBe(2);
  });
});

describe("pickLevelFromOcrMeta", () => {
  it("uses title block lines when levelName is missing", () => {
    const level = pickLevelFromOcrMeta({
      title: "SECOND FLOOR PLAN",
      lines: [{ text: "SCALE 1:100 @ A1", confidence: 0.9 }],
    });
    expect(level).toBe("Second Floor Plan");
  });

  it("prefers explicit levelName from OCR", () => {
    expect(
      pickLevelFromOcrMeta({
        levelName: "Level 04",
        title: "GROUND FLOOR PLAN",
      }),
    ).toBe("Level 04");
  });
});

describe("resolveFloorPageMeta", () => {
  it("wires OCR level into hierarchy page meta", () => {
    const meta = resolveFloorPageMeta(
      {
        id: "p1",
        pageNumber: 2,
        imagePath: "idb:x",
        widthPx: 100,
        heightPx: 100,
        isFloorPlan: true,
        ocrMeta: {
          title: "FIRST FLOOR PLAN",
          lines: [{ text: "FIRST FLOOR PLAN", confidence: 0.95 }],
        },
      },
      "tower.pdf",
    );
    expect(meta.levelName).toBe("First Floor Plan");
    expect(meta.levelIndex).toBe(1);
    expect(meta.isFloorPlan).toBe(true);
  });

  it("parses unit ids from title-block and drawing OCR text", () => {
    const meta = resolveFloorPageMeta(
      {
        id: "p1",
        pageNumber: 1,
        imagePath: "idb:x",
        widthPx: 100,
        heightPx: 100,
        ocrMeta: {
          title: "FIRST FLOOR PLAN",
          lines: [
            { text: "FIRST FLOOR PLAN", confidence: 0.99 },
            { text: "Unit 101", confidence: 0.94 },
            { text: "UNIT 102", confidence: 0.91 },
          ],
        },
        drawingOcrMeta: {
          lines: [{ text: "Apt 12B", confidence: 0.88 }],
        },
      },
      "tower.pdf",
    );
    expect(meta.levelName).toBe("First Floor Plan");
    expect(meta.ocrUnitIds).toEqual(["101", "102", "12B"]);
  });

  it("prefers OCR floor name over placeholder Floor N", () => {
    const meta = resolveFloorPageMeta(
      {
        id: "p1",
        pageNumber: 1,
        imagePath: "idb:x",
        widthPx: 100,
        heightPx: 100,
        levelName: "Floor 1",
        levelIndex: 0,
        ocrMeta: {
          title: "SECOND FLOOR PLAN",
          lines: [{ text: "SECOND FLOOR PLAN", confidence: 0.92 }],
        },
      },
      "tower.pdf",
    );
    expect(meta.levelName).toBe("Second Floor Plan");
    expect(meta.levelIndex).toBe(2);
  });
});

describe("resolvePageLevelName", () => {
  it("detects placeholder labels", () => {
    expect(isPlaceholderFloorLabel("Floor 1")).toBe(true);
    expect(isPlaceholderFloorLabel("Level 3")).toBe(true);
    expect(isPlaceholderFloorLabel("First Floor")).toBe(false);
  });

  it("reads level from drawing OCR when title block is empty", () => {
    expect(
      resolvePageLevelName({
        id: "p1",
        pageNumber: 3,
        imagePath: "x",
        widthPx: 1,
        heightPx: 1,
        levelName: "Floor 3",
        drawingOcrMeta: {
          lines: [{ text: "THIRD FLOOR PLAN", confidence: 0.9 }],
        },
      }),
    ).toBe("Third Floor Plan");
  });
});

describe("resolveBuildingName", () => {
  it("prefers project name", () => {
    expect(
      resolveBuildingName({
        projectName: "Riverside Apartments",
        sourceFileName: "plans.pdf",
      }),
    ).toBe("Riverside Apartments");
  });

  it("falls back to non-floor OCR title then filename stem", () => {
    expect(
      resolveBuildingName({
        pages: [
          {
            id: "p1",
            pageNumber: 1,
            imagePath: "x",
            widthPx: 1,
            heightPx: 1,
            ocrMeta: { title: "FIRST FLOOR PLAN" },
          },
          {
            id: "p2",
            pageNumber: 2,
            imagePath: "x",
            widthPx: 1,
            heightPx: 1,
            ocrMeta: { title: "Harbour View Tower" },
          },
        ],
        sourceFileName: "tower-plans.pdf",
      }),
    ).toBe("Harbour View Tower");
  });
});

describe("pickLevelFromLines", () => {
  it("scores floor plan lines higher", () => {
    const level = pickLevelFromLines([
      { text: "BED 1", confidence: 0.99 },
      { text: "SECOND FLOOR PLAN", confidence: 0.88 },
    ]);
    expect(level).toBe("Second Floor Plan");
  });
});

describe("applyOcrLevelToPage", () => {
  const page: PlanPage = {
    id: "p1",
    pageNumber: 1,
    imagePath: "x",
    widthPx: 100,
    heightPx: 100,
    isFloorPlan: true,
  };

  it("keeps title-block OCR lines on the page", () => {
    const next = applyOcrLevelToPage(page, {
      title: "FIRST FLOOR PLAN",
      scaleText: "1:100 @ A1",
      lines: [
        { text: "FIRST FLOOR PLAN", confidence: 0.9 },
        { text: "SCALE 1:100 @ A1", confidence: 0.88 },
      ],
    });
    expect(next.ocrMeta?.lines).toHaveLength(2);
    expect(next.ocrMeta?.lines?.map((l) => l.text)).toEqual([
      "FIRST FLOOR PLAN",
      "SCALE 1:100 @ A1",
    ]);
    expect(next.levelName).toBe("First Floor Plan");
  });

  it("does not wipe ocrMeta when called with only the page", () => {
    const withMeta = { ...page, ocrMeta: { lines: [{ text: "SCALE 1:50", confidence: 1 }] } };
    const next = applyOcrLevelToPage(withMeta);
    expect(next.ocrMeta?.lines).toEqual([{ text: "SCALE 1:50", confidence: 1 }]);
  });
});

describe("parseUnitIds", () => {
  it("reads Unit 101 style labels and ignores unit plan", () => {
    expect(parseUnitIds("FIRST FLOOR PLAN  Unit 101  UNIT 102")).toEqual(["101", "102"]);
    expect(parseUnitIds("UNIT PLAN")).toEqual([]);
  });

  it("reads drawing-area apartment labels", () => {
    expect(pickUnitIdsFromPage({
      id: "p1",
      pageNumber: 1,
      imagePath: "x",
      widthPx: 1,
      heightPx: 1,
      isFloorPlan: true,
      drawingOcrMeta: { lines: [{ text: "Apt 5A", confidence: 0.9 }] },
    })).toEqual(["5A"]);
  });
});
