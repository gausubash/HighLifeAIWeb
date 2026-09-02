import type { PolicyGuideline, PolicyPack, PolicySourceRect } from "@highlife/shared-types";
import type { PolicyPdfLayout, PolicyPdfLine } from "./extractPolicyPdfLayout";

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").replace(/[“”"']/g, "").trim();
}

function lineToRect(line: PolicyPdfLine): PolicySourceRect {
  return {
    page: line.page,
    x: line.x,
    y: line.y,
    width: line.width,
    height: line.height,
  };
}

function unionRects(lines: PolicyPdfLine[]): PolicySourceRect[] {
  const byPage = new Map<number, PolicyPdfLine[]>();
  for (const line of lines) {
    const list = byPage.get(line.page) ?? [];
    list.push(line);
    byPage.set(line.page, list);
  }
  return [...byPage.entries()].map(([page, pageLines]) => {
    const x = Math.min(...pageLines.map((l) => l.x));
    const y = Math.min(...pageLines.map((l) => l.y));
    const right = Math.max(...pageLines.map((l) => l.x + l.width));
    const bottom = Math.max(...pageLines.map((l) => l.y + l.height));
    return { page, x, y, width: right - x, height: bottom - y };
  });
}

function scoreLine(line: PolicyPdfLine, excerpt: string): number {
  const a = normalize(line.text);
  const b = normalize(excerpt);
  if (!a || !b) return 0;
  if (b.includes(a) && a.length >= 16) return a.length / b.length + 0.4;
  if (a.includes(b) && b.length >= 16) return b.length / a.length + 0.35;
  const words = b.split(" ").filter((w) => w.length > 3);
  if (words.length < 3) return 0;
  const hits = words.filter((w) => a.includes(w)).length;
  const ratio = hits / words.length;
  return ratio >= 0.55 ? ratio : 0;
}

export function findBestLines(lines: PolicyPdfLine[], excerpt: string, limit = 4): PolicyPdfLine[] {
  const scored = lines
    .map((line) => ({ line, score: scoreLine(line, excerpt) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return [];
  const top = scored[0];
  const samePage = scored.filter((row) => row.line.page === top.line.page && row.score >= top.score * 0.7);
  return samePage.slice(0, limit).map((row) => row.line);
}

export function attachGuidelineRects(pack: PolicyPack, layout: PolicyPdfLayout): PolicyPack {
  const byId = new Map(layout.lines.map((line) => [line.id, line]));
  const guidelines: PolicyGuideline[] = (pack.guidelines ?? []).map((guideline) => {
    const fromIds = (guideline.lineIds ?? [])
      .map((id) => byId.get(id))
      .filter((line): line is PolicyPdfLine => line != null);
    if (fromIds.length) {
      return {
        ...guideline,
        page: guideline.page ?? fromIds[0].page,
        rects: unionRects(fromIds),
      };
    }
    const excerpt = guideline.sourceText || guideline.text;
    const hits = findBestLines(layout.lines, excerpt);
    if (!hits.length) return scaleNormalizedRects(guideline, layout.pages);
    return {
      ...guideline,
      page: guideline.page ?? hits[0].page,
      lineIds: hits.map((line) => line.id),
      rects: unionRects(hits),
    };
  });
  return {
    ...pack,
    guidelines: guidelines.map((guideline) =>
      guideline.rects?.length ? guideline : scaleNormalizedRects(guideline, layout.pages),
    ),
    sourcePages: pack.sourcePages?.length ? pack.sourcePages : layout.pages,
  };
}

/** Vision models return page fractions (0–1); convert them to pdf.js viewport pixels. */
export function scaleNormalizedRects(
  guideline: PolicyGuideline,
  pages: Array<{ pageNumber: number; width: number; height: number }>,
): PolicyGuideline {
  const rects = guideline.rects;
  if (!rects?.length) return guideline;
  const byPage = new Map(pages.map((p) => [p.pageNumber, p]));
  return {
    ...guideline,
    rects: rects.map((rect) => {
      const page = byPage.get(rect.page || guideline.page || 1);
      const normalized = rect.width <= 1.5 && rect.height <= 1.5 && rect.x <= 1.5 && rect.y <= 1.5;
      if (!page || !normalized) return rect;
      return {
        page: rect.page || guideline.page || page.pageNumber,
        x: rect.x * page.width,
        y: rect.y * page.height,
        width: rect.width * page.width,
        height: rect.height * page.height,
      };
    }),
  };
}
