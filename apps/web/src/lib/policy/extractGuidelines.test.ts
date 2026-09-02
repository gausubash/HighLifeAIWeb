import { describe, expect, it } from "vitest";
import { extractGuidelinesFromLayout, isGuidelineHeading, wrapRulesAsGuidelines } from "./extractGuidelines";
import { clusterPolicyTextItems, type PolicyPdfLayout } from "./extractPolicyPdfLayout";
import { attachGuidelineRects, findBestLines, scaleNormalizedRects } from "./matchGuidelineRects";
import { selectPolicyVisionPages } from "./extractPolicyPdfPages";
import { parsePolicyJsonText } from "./parsePolicyPack";

function layout(lines: Array<{ text: string; page?: number }>): PolicyPdfLayout {
  const mapped = lines.map((line, i) => ({
    id: `p${line.page ?? 1}L${i + 1}`,
    page: line.page ?? 1,
    text: line.text,
    x: 40,
    y: 40 + i * 16,
    width: 400,
    height: 12,
  }));
  return {
    fileName: "rds.pdf",
    pages: [{ pageNumber: 1, width: 595, height: 842 }],
    lines: mapped,
    llmText: mapped.map((l) => `[${l.id}] ${l.text}`).join("\n"),
  };
}

describe("clusterPolicyTextItems", () => {
  it("joins items on the same baseline", () => {
    const lines = clusterPolicyTextItems([
      { text: "Apartments", x: 40, y: 80, width: 80, height: 10 },
      { text: "shall have", x: 130, y: 81, width: 70, height: 10 },
      { text: "Next line", x: 40, y: 110, width: 60, height: 10 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]?.text).toBe("Apartments shall have");
  });
});

describe("isGuidelineHeading", () => {
  it("treats numbered clauses and all-caps titles as headings", () => {
    expect(isGuidelineHeading("4.2 Internal areas")).toBe(true);
    expect(isGuidelineHeading("STANDARD 5 — LIGHT")).toBe(true);
    expect(isGuidelineHeading("Apartments shall have 50 m2 of internal area.")).toBe(false);
  });
});

describe("extractGuidelinesFromLayout", () => {
  it("groups obligations under the last heading", () => {
    const pack = extractGuidelinesFromLayout(
      layout([
        { text: "4.2 Internal areas" },
        { text: "Apartments shall have a minimum internal area of 50 m2." },
        { text: "4.3 Private open space" },
        { text: "A balcony must be at least 8 sqm." },
        { text: "Habitable rooms should have a window to the outside." },
      ]),
      "rds.pdf",
    );
    expect(pack.guidelines?.map((g) => g.group)).toEqual([
      "4.2 Internal areas",
      "4.3 Private open space",
      "4.3 Private open space",
    ]);
    expect(pack.guidelines?.[0]?.mappedKind).toBe("apartment_min_internal");
    expect(pack.guidelines?.[1]?.mappedKind).toBe("apartment_min_pos");
    expect(pack.guidelines?.[2]?.mappedKind).toBe("habitable_has_window");
    expect(pack.guidelines?.every((g) => g.status === "pending")).toBe(true);
    expect(pack.guidelines?.[0]?.rects?.length).toBeGreaterThan(0);
  });
});

describe("matchGuidelineRects", () => {
  it("finds the line that contains the excerpt", () => {
    const doc = layout([
      { text: "Intro text that is not a rule." },
      { text: "A balcony must be at least 8 sqm." },
    ]);
    const hits = findBestLines(doc.lines, "balcony must be at least 8 sqm");
    expect(hits[0]?.id).toBe("p1L2");
    const pack = attachGuidelineRects(
      {
        id: "x",
        version: "x",
        name: "X",
        rules: [],
        guidelines: [
          {
            id: "g-1",
            group: "POS",
            name: "Balcony",
            text: "A balcony must be at least 8 sqm.",
            sourceText: "balcony must be at least 8 sqm",
            status: "pending",
          },
        ],
      },
      doc,
    );
    expect(pack.guidelines?.[0]?.page).toBe(1);
    expect(pack.guidelines?.[0]?.rects?.[0]?.y).toBeGreaterThan(40);
  });
});

describe("parsePolicyPack guidelines", () => {
  it("accepts grouped guidelines without a rules array", () => {
    const pack = parsePolicyJsonText(
      JSON.stringify({
        version: "custom_v2",
        name: "Custom",
        groups: [
          {
            title: "Light",
            guidelines: [
              {
                name: "Window",
                text: "Habitable rooms shall have a window.",
                mappedKind: "habitable_has_window",
              },
            ],
          },
        ],
      }),
      "custom.json",
    );
    expect(pack.guidelines).toHaveLength(1);
    expect(pack.guidelines?.[0]?.group).toBe("Light");
    expect(pack.guidelines?.[0]?.status).toBe("pending");
    expect(pack.rules[0]?.kind).toBe("habitable_has_window");
    expect(pack.rules[0]?.guidelineId).toBe(pack.guidelines?.[0]?.id);
  });
});

describe("selectPolicyVisionPages", () => {
  it("keeps every page when under the limit", () => {
    expect(
      selectPolicyVisionPages([
        { pageNumber: 1, textChars: 800, imageOps: 0 },
        { pageNumber: 2, textChars: 200, imageOps: 3 },
      ]),
    ).toEqual([1, 2]);
  });

  it("prefers image-heavy and sparse-text pages when capping", () => {
    const pages = Array.from({ length: 20 }, (_, i) => ({
      pageNumber: i + 1,
      textChars: i === 7 ? 20 : 900,
      imageOps: i === 3 ? 4 : 0,
    }));
    const selected = selectPolicyVisionPages(pages, 3);
    expect(selected).toContain(4);
    expect(selected).toContain(8);
    expect(selected).toHaveLength(3);
  });
});

describe("scaleNormalizedRects", () => {
  it("converts 0–1 vision boxes to page pixels", () => {
    const scaled = scaleNormalizedRects(
      {
        id: "g-1",
        group: "Tables",
        name: "Studio",
        text: "Studio 35 m2",
        page: 2,
        status: "pending",
        rects: [{ page: 2, x: 0.1, y: 0.2, width: 0.5, height: 0.1 }],
      },
      [{ pageNumber: 2, width: 200, height: 400 }],
    );
    expect(scaled.rects?.[0]).toEqual({ page: 2, x: 20, y: 80, width: 100, height: 40 });
  });
});

describe("wrapRulesAsGuidelines", () => {
  it("turns legacy rules into pending review items", () => {
    const wrapped = wrapRulesAsGuidelines({
      id: "legacy",
      version: "legacy",
      name: "Legacy",
      rules: [{ code: "A", name: "Bed min", kind: "apartment_min_bedroom", minAreaM2: 9 }],
    });
    expect(wrapped.guidelines).toHaveLength(1);
    expect(wrapped.rules[0]?.guidelineId).toBe(wrapped.guidelines?.[0]?.id);
  });
});
