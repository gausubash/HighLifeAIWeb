import type { PolicyGuideline, PolicyPack, PolicyRule, PolicyRuleKind } from "@highlife/shared-types";
import type { PolicyPdfLayout } from "./extractPolicyPdfLayout";
import { attachGuidelineRects } from "./matchGuidelineRects";

const OBLIGATION =
  /\b(shall|must|should|required|must not|shall not|minimum|not less than|no less than|at least|is to be|are to be|needs to|need to)\b/i;

const LIST_ITEM = /^(?:[•·▪–—-]\s+|\(?[a-z]\)\s+|[ivxlcdm]+\)\s+|\d+[.)]\s+)/i;

const KIND_HINTS: Array<{ kind: PolicyRuleKind; re: RegExp }> = [
  { kind: "apartment_min_internal", re: /\b(internal area|apartment size|minimum (internal )?area|dwelling size)\b/i },
  { kind: "apartment_min_living", re: /\bliving (room|area|space)\b/i },
  { kind: "apartment_min_pos", re: /\b(private open space|balcony|courtyard)\b/i },
  { kind: "apartment_min_bedroom", re: /\bbedroom\b/i },
  { kind: "apartment_min_bathrooms", re: /\b(bathroom|wc|toilet)\b/i },
  { kind: "apartment_min_storage", re: /\b(storage|wardrobe|robe)\b/i },
  { kind: "apartment_dual_aspect", re: /\b(dual aspect|two (elevations|aspects|sides)|natural ventilation)\b/i },
  { kind: "habitable_has_window", re: /\b(habitable.{0,40}window|window.{0,30}habitable|natural light)\b/i },
  { kind: "communal_open_space", re: /\bcommunal (open space|outdoor)\b/i },
];

function isNoise(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) return true;
  if (/^page\s+\d+(\s+of\s+\d+)?$/i.test(t)) return true;
  if (/^\d+\s*$/.test(t)) return true;
  if (/\.{4,}/.test(t) && t.length < 80) return true;
  if (/^(contents|table of contents|index)$/i.test(t)) return true;
  return false;
}

export function isGuidelineHeading(text: string): boolean {
  const t = text.trim();
  if (t.length < 3 || t.length > 100) return false;
  if (isNoise(t)) return false;
  if (/^\d+(\.\d+){0,4}\s+\S/.test(t)) return true;
  if (/^(standard|objective|requirement|design|clause|part|section|appendix|element|control)\b/i.test(t)) {
    return true;
  }
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 6 && letters === letters.toUpperCase() && t.length <= 80) return true;
  return false;
}

function inferMappedKind(text: string): PolicyRuleKind | null {
  for (const { kind, re } of KIND_HINTS) {
    if (re.test(text)) return kind;
  }
  return null;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function slugId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`;
}

export function extractGuidelinesFromLayout(layout: PolicyPdfLayout, fileName?: string): PolicyPack {
  const guidelines: PolicyGuideline[] = [];
  let group = "General";
  let groupClause: string | undefined;
  const pendingParagraph: { lineIds: string[]; text: string; page: number } = {
    lineIds: [],
    text: "",
    page: 1,
  };

  const flushParagraph = () => {
    const text = pendingParagraph.text.replace(/\s+/g, " ").trim();
    const lineIds = [...pendingParagraph.lineIds];
    const page = pendingParagraph.page;
    pendingParagraph.lineIds = [];
    pendingParagraph.text = "";
    if (!text || isNoise(text) || isGuidelineHeading(text)) return;
    const sentences = splitSentences(text);
    const obligated = sentences.filter((s) => OBLIGATION.test(s) || LIST_ITEM.test(s));
    const pieces = obligated.length ? obligated : text.length >= 40 ? [text] : [];
    for (const piece of pieces) {
      const name = piece.length > 72 ? `${piece.slice(0, 69).trim()}…` : piece;
      guidelines.push({
        id: slugId("g", guidelines.length),
        group,
        name,
        text: piece,
        clause: groupClause,
        sourceText: piece.slice(0, 240),
        page,
        lineIds,
        status: "pending",
        mappedKind: inferMappedKind(piece),
      });
    }
  };

  for (const line of layout.lines) {
    if (isGuidelineHeading(line.text) && !OBLIGATION.test(line.text)) {
      flushParagraph();
      group = line.text.replace(/\s+/g, " ").trim();
      const clause = group.match(/^(\d+(?:\.\d+)*)/);
      groupClause = clause?.[1];
      continue;
    }
    if (isNoise(line.text)) continue;
    if (pendingParagraph.lineIds.length && line.page !== pendingParagraph.page) {
      flushParagraph();
    }
    pendingParagraph.page = line.page;
    pendingParagraph.lineIds.push(line.id);
    pendingParagraph.text = pendingParagraph.text ? `${pendingParagraph.text} ${line.text}` : line.text;
    if (LIST_ITEM.test(line.text) || /[.!?]$/.test(line.text)) {
      flushParagraph();
    }
  }
  flushParagraph();

  const stem = (fileName ?? layout.fileName).replace(/\.[^.]+$/, "") || "uploaded-policy";
  const rules = rulesFromMappedGuidelines(guidelines);
  const pack: PolicyPack = {
    id: `pdf:${stem}:${Date.now()}`,
    version: stem.replace(/\s+/g, "_").toLowerCase(),
    name: stem,
    description:
      "Extracted every design guideline we could group from the document. Accept the ones you want to use.",
    source: { kind: "pdf", fileName: fileName ?? layout.fileName },
    notes:
      guidelines.length === 0
        ? ["No design guidelines were recognised. The PDF may be a scan or mostly images."]
        : [
            `${guidelines.length} guideline${guidelines.length === 1 ? "" : "s"} grouped from document headings. Review and accept before checking the plan.`,
          ],
    rules,
    guidelines,
    sourcePages: layout.pages,
    createdAt: new Date().toISOString(),
  };
  return attachGuidelineRects(pack, layout);
}

export function rulesFromMappedGuidelines(guidelines: PolicyGuideline[]): PolicyRule[] {
  const rules: PolicyRule[] = [];
  for (const guideline of guidelines) {
    if (!guideline.mappedKind) continue;
    rules.push({
      code: guideline.clause || guideline.id.toUpperCase(),
      name: guideline.name,
      kind: guideline.mappedKind,
      guidelineId: guideline.id,
      clause: guideline.clause,
      requiresScale: guideline.mappedKind !== "apartment_dual_aspect" && guideline.mappedKind !== "habitable_has_window",
      sourceText: guideline.sourceText ?? guideline.text.slice(0, 240),
    });
  }
  return rules;
}

export function wrapRulesAsGuidelines(pack: PolicyPack): PolicyPack {
  if (pack.guidelines?.length) {
    const rules = pack.rules.map((rule) => {
      if (rule.guidelineId) return rule;
      const match = pack.guidelines?.find(
        (g) => g.mappedKind === rule.kind && (g.sourceText === rule.sourceText || g.name === rule.name),
      );
      return match ? { ...rule, guidelineId: match.id } : rule;
    });
    return { ...pack, rules };
  }
  const guidelines: PolicyGuideline[] = pack.rules.map((rule, index) => ({
    id: `rule-${index + 1}`,
    group: "Extracted checks",
    name: rule.name,
    text: rule.sourceText || rule.explanation || rule.name,
    clause: rule.clause,
    sourceText: rule.sourceText,
    status: "pending",
    mappedKind: rule.kind,
  }));
  return {
    ...pack,
    guidelines,
    rules: pack.rules.map((rule, index) => ({ ...rule, guidelineId: guidelines[index].id })),
  };
}
