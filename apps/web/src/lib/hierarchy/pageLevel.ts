import type { PageOcrMeta, PlanPage } from "@highlife/shared-types";
import type { FloorPageMeta } from "@/lib/hierarchy/buildHierarchy";

const LEVEL_RE =
  /\b(?:level|lvl|floor|storey|story)\s*[-.:#]?\s*([A-Z0-9]+|\d+[A-Z]?)\b|\b(?:L|LVL|FL|FLR)\s*[-.:#]?\s*(\d+[A-Z]?)\b|\b(ground\s+floor|ground\s+level|basement(?:\s+\d+)?|mezzanine(?:\s+floor|\s+level)?|podium(?:\s+level)?|roof(?:\s+plan|\s+level)?)\b/i;

const ORDINAL_FLOOR_RE =
  /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|1st|2nd|3rd|[4-9]th|\d+(?:st|nd|rd|th))\s+floor\b/i;

const ORDINAL_LABEL: Record<string, string> = {
  first: "First Floor",
  "1st": "First Floor",
  second: "Second Floor",
  "2nd": "Second Floor",
  third: "Third Floor",
  "3rd": "Third Floor",
  fourth: "Fourth Floor",
  "4th": "Fourth Floor",
  fifth: "Fifth Floor",
  "5th": "Fifth Floor",
  sixth: "Sixth Floor",
  "6th": "Sixth Floor",
  seventh: "Seventh Floor",
  "7th": "Seventh Floor",
  eighth: "Eighth Floor",
  "8th": "Eighth Floor",
  ninth: "Ninth Floor",
  "9th": "Ninth Floor",
  tenth: "Tenth Floor",
  "10th": "Tenth Floor",
  eleventh: "Eleventh Floor",
  "11th": "Eleventh Floor",
  twelfth: "Twelfth Floor",
  "12th": "Twelfth Floor",
};

const ORDINAL_INDEX: Record<string, number> = {
  first: 1,
  "1st": 1,
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  fourth: 4,
  "4th": 4,
  fifth: 5,
  "5th": 5,
  sixth: 6,
  "6th": 6,
  seventh: 7,
  "7th": 7,
  eighth: 8,
  "8th": 8,
  ninth: 9,
  "9th": 9,
  tenth: 10,
  "10th": 10,
  eleventh: 11,
  "11th": 11,
  twelfth: 12,
  "12th": 12,
};

const TITLE_CUES = [
  "floor plan",
  "unit plan",
  "general arrangement",
  "ga plan",
  "rcp",
  "reflected ceiling",
];

const UNIT_RE =
  /\b(?:unit|apt|apartment|dwelling|tenancy|flat|suite)\s*(?:no\.?|nos\.?|number|#)?\s*[.:-]?\s*([A-Z0-9]{1,8})\b/gi;

const UNIT_U_RE = /\bU\s*[-#.]?\s*(\d{1,4}[A-Za-z]?)\b/gi;

const UNIT_ID_STOPWORDS = new Set([
  "PLAN",
  "TYPE",
  "MIX",
  "SCHEDULE",
  "KEY",
  "AREA",
  "LAYOUT",
  "NUMBER",
  "NO",
  "NOS",
  "ID",
  "IDS",
  "INDEX",
  "LIST",
  "TABLE",
  "EN",
  "ENT",
  "ENS",
  "CT",
  "WC",
]);

/** Dwelling numbers (`101`, `12B`) or a single letter (`A`). Reject OCR crumbs like EN / CT. */
export function isPlausibleUnitId(raw: string | null | undefined): boolean {
  const uid = (raw ?? "").trim().toUpperCase();
  if (!uid || UNIT_ID_STOPWORDS.has(uid)) return false;
  if (/[0-9]/.test(uid)) return true;
  return uid.length === 1 && /[A-Z]/.test(uid);
}

function titleCasePhrase(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Keep "Plan" when OCR read "FIRST FLOOR PLAN" rather than shortening to "First Floor". */
function withPlanSuffix(label: string, source: string): string {
  if (/\bplan\b/i.test(label)) return label;
  if (/\b(?:floor|level|storey|story)\s+plan\b/i.test(source)) return `${label} Plan`;
  return label;
}

/** Parse a storey / floor label from title-block text (mirrors inference OCR parsers). */
export function parseLevelName(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const raw = text.trim();

  const ordinal = ORDINAL_FLOOR_RE.exec(raw);
  if (ordinal) {
    const token = ordinal[1].toLowerCase();
    let label: string | null = null;
    if (ORDINAL_LABEL[token]) label = ORDINAL_LABEL[token];
    else {
      const num = parseInt(token, 10);
      if (Number.isFinite(num) && num > 0) label = `Level ${num}`;
    }
    if (label) return withPlanSuffix(label, raw);
  }

  const m = LEVEL_RE.exec(raw);
  if (!m) return null;
  if (m[3]) {
    return withPlanSuffix(titleCasePhrase(m[3]), raw);
  }
  const token = (m[1] || m[2] || "").trim().toUpperCase();
  if (!token) return null;
  if (/^\d+[A-Z]?$/.test(token)) return withPlanSuffix(`Level ${token}`, raw);
  if (token === "G" || token === "GF") return withPlanSuffix("Ground Floor", raw);
  return withPlanSuffix(`Level ${token}`, raw);
}

/** Parse unit identifiers from OCR text ("Unit 101", "APT 12B"). */
export function parseUnitIds(text: string | null | undefined, limit = 20): string[] {
  if (!text?.trim()) return [];
  const hits: { uid: string; index: number }[] = [];
  const re = new RegExp(UNIT_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const uid = (match[1] ?? "").trim().toUpperCase();
    if (!isPlausibleUnitId(uid)) continue;
    hits.push({ uid, index: match.index });
  }
  const ure = new RegExp(UNIT_U_RE.source, "gi");
  while ((match = ure.exec(text)) !== null) {
    const uid = (match[1] ?? "").trim().toUpperCase();
    if (!isPlausibleUnitId(uid)) continue;
    hits.push({ uid, index: match.index });
  }
  hits.sort((a, b) => a.index - b.index);
  const found: string[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (seen.has(hit.uid)) continue;
    seen.add(hit.uid);
    found.push(hit.uid);
    if (found.length >= limit) break;
  }
  return found;
}

function mergeUnitIds(...groups: Array<string[] | null | undefined>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const raw of group ?? []) {
      const uid = raw.trim().toUpperCase();
      if (!isPlausibleUnitId(uid) || seen.has(uid)) continue;
      seen.add(uid);
      found.push(uid);
    }
  }
  return found;
}

export function pickUnitIdsFromOcrMeta(meta: PageOcrMeta | null | undefined): string[] {
  if (!meta) return [];
  const blob = [meta.title, meta.textHint, ...(meta.lines ?? []).map((l) => l.text ?? "")]
    .filter(Boolean)
    .join("\n");
  return mergeUnitIds(meta.unitIds, parseUnitIds(blob));
}

function concatUniqueUnitIds(...groups: Array<string[] | null | undefined>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const raw of group ?? []) {
      const uid = raw.trim().toUpperCase();
      if (!uid || seen.has(uid)) continue;
      seen.add(uid);
      found.push(uid);
    }
  }
  return found;
}

export function pickUnitIdsFromPage(page: PlanPage): string[] {
  return concatUniqueUnitIds(
    page.manualUnitIds,
    pickUnitIdsFromOcrMeta(page.ocrMeta),
    pickUnitIdsFromOcrMeta(page.drawingOcrMeta),
  );
}

const MANUAL_UNIT_PREFIX = /^(?:UNIT|APT|APARTMENT|FLAT|DWELLING)\s*(?:NO\.?|NUMBER|#)?\s*/i;

/** Normalize a user-typed unit id (`101`, `12B`, `Unit A`). */
export function normalizeManualUnitId(raw: string | null | undefined): string | null {
  const stripped = (raw ?? "").trim().replace(MANUAL_UNIT_PREFIX, "").replace(/\s+/g, "").toUpperCase();
  if (!stripped || stripped.length > 12) return null;
  if (isPlausibleUnitId(stripped)) return stripped;
  if (/^[A-Z][A-Z0-9._-]{0,11}$/.test(stripped) && !UNIT_ID_STOPWORDS.has(stripped)) return stripped;
  return null;
}

export function parseManualUnitIds(raw: string | null | undefined): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const part of (raw ?? "").split(/[,;]+/)) {
    const uid = normalizeManualUnitId(part);
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    found.push(uid);
  }
  return found;
}

export function addManualUnitIds(page: PlanPage, raw: string): PlanPage {
  const added = parseManualUnitIds(raw);
  if (!added.length) return page;
  return { ...page, manualUnitIds: concatUniqueUnitIds(page.manualUnitIds, added) };
}

export function removeManualUnitId(page: PlanPage, raw: string): PlanPage {
  const uid = normalizeManualUnitId(raw) ?? raw.trim().replace(/^unit[\s#:-]*/i, "").toUpperCase();
  if (!uid) return page;
  const drop = (ids: string[] | undefined) =>
    (ids ?? []).filter((id) => id.trim().toUpperCase() !== uid);
  return {
    ...page,
    manualUnitIds: drop(page.manualUnitIds),
    ocrMeta: page.ocrMeta ? { ...page.ocrMeta, unitIds: drop(page.ocrMeta.unitIds) } : page.ocrMeta,
    drawingOcrMeta: page.drawingOcrMeta
      ? { ...page.drawingOcrMeta, unitIds: drop(page.drawingOcrMeta.unitIds) }
      : page.drawingOcrMeta,
  };
}

export function pickLevelFromLines(
  lines: { text?: string | null; confidence?: number | null }[] | null | undefined,
): string | null {
  if (!lines?.length) return null;
  let best: { score: number; level: string } | null = null;
  for (const row of lines) {
    const text = row.text?.trim();
    if (!text) continue;
    const level = parseLevelName(text);
    if (!level) continue;
    const conf = row.confidence ?? 0;
    let score = conf;
    const low = text.toLowerCase();
    if (
      low.includes("floor plan") ||
      low.includes("level") ||
      low.includes("floor") ||
      low.includes("storey") ||
      low.includes("story") ||
      low.includes("ground")
    ) {
      score += 0.4;
    }
    if (!best || score > best.score) best = { score, level };
  }
  if (best) return best.level;
  const joined = lines.map((l) => l.text ?? "").filter(Boolean).join("\n");
  return parseLevelName(joined);
}

export function pickLevelFromOcrMeta(meta: PageOcrMeta | null | undefined): string | null {
  if (!meta) return null;
  const fromTitle = meta.title ? parseLevelName(meta.title) : null;
  const fromLines = pickLevelFromLines(meta.lines);
  const storedRaw = meta.levelName?.trim() || null;
  const stored = storedRaw ? parseLevelName(storedRaw) || storedRaw : null;
  const detected = fromTitle || fromLines;
  if (detected && stored && isSameFloorLabel(stored, detected)) {
    return /\bplan\b/i.test(detected) ? detected : stored;
  }
  if (stored) return stored;
  return detected;
}

function isSameFloorLabel(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+plan\b/, "");
  return norm(a) === norm(b);
}

/** Sortable 0-based storey index derived from a level label. */
export function levelIndexFromName(name: string | null | undefined): number | null {
  if (!name?.trim()) return null;
  const n = name.trim().toLowerCase();

  if (n.includes("basement")) return -1;
  if (n.includes("ground") || n === "gf") return 0;
  if (n.includes("mezzanine")) return 0;
  if (n.includes("podium")) return 0;
  if (n.includes("roof")) return 100;

  const ordinal = ORDINAL_FLOOR_RE.exec(n);
  if (ordinal) {
    const token = ordinal[1].toLowerCase();
    if (ORDINAL_INDEX[token] != null) return ORDINAL_INDEX[token];
    const num = parseInt(token, 10);
    if (Number.isFinite(num) && num > 0) return num;
  }

  const levelNum = n.match(/\blevel\s*(\d+[a-z]?)\b/i);
  if (levelNum) {
    const digits = parseInt(levelNum[1], 10);
    if (Number.isFinite(digits)) return Math.max(0, digits - 1);
  }

  if (n.includes("first floor")) return 1;
  if (n.includes("second floor")) return 2;
  if (n.includes("third floor")) return 3;
  if (n.includes("fourth floor")) return 4;
  if (n.includes("fifth floor")) return 5;

  return null;
}

export function inferIsFloorPlanFromOcr(meta: PageOcrMeta | null | undefined): boolean {
  if (!meta) return true;
  const sheet = (meta.sheetType ?? "").toLowerCase();
  if (sheet === "rcp") return false;
  const blob = [meta.title, meta.levelName, meta.textHint, ...(meta.lines ?? []).map((l) => l.text)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (blob.includes("reflected ceiling") || /\brcp\b/.test(blob)) return false;
  if (sheet === "ga" || sheet === "unit") return true;
  if (TITLE_CUES.some((c) => blob.includes(c))) return true;
  return true;
}

/** Default labels assigned at upload before title-block OCR runs. */
export function isPlaceholderFloorLabel(name: string | null | undefined): boolean {
  if (!name?.trim()) return true;
  const n = name.trim();
  return /^floor\s*#?\s*\d+$/i.test(n) || /^level\s*#?\s*\d+$/i.test(n);
}

export function resolvePageLevelName(page: PlanPage): string {
  const ocrLevel =
    pickLevelFromOcrMeta(page.ocrMeta) || pickLevelFromOcrMeta(page.drawingOcrMeta);
  if (ocrLevel) return ocrLevel;
  const manual = page.levelName?.trim();
  if (manual && !isPlaceholderFloorLabel(manual)) return manual;
  return `Floor ${page.pageNumber}`;
}

export function resolvePageLevelIndex(page: PlanPage, levelName: string): number {
  return levelIndexFromName(levelName) ?? page.levelIndex ?? page.pageNumber - 1;
}

export function applyOcrLevelToPage<T extends PlanPage>(page: T, meta?: PageOcrMeta | null): T {
  const nextMeta = meta ?? page.ocrMeta ?? null;
  const withMeta = nextMeta ? { ...page, ocrMeta: nextMeta } : page;
  const levelName = resolvePageLevelName(withMeta);
  const levelIndex = resolvePageLevelIndex(withMeta, levelName);
  const isFloorPlan = inferIsFloorPlanFromOcr(nextMeta);
  const ocrMeta = nextMeta
    ? {
        ...nextMeta,
        levelName: nextMeta.levelName?.trim() || levelName,
        unitIds: pickUnitIdsFromOcrMeta(nextMeta),
      }
    : page.ocrMeta;
  return {
    ...page,
    ...(ocrMeta ? { ocrMeta } : {}),
    levelName,
    levelIndex,
    isFloorPlan,
  };
}

export function resolveFloorPageMeta(
  page: PlanPage,
  sourceFileName?: string | null,
): FloorPageMeta {
  const levelName = resolvePageLevelName(page);
  const levelIndex = resolvePageLevelIndex(page, levelName);
  const isFloorPlan =
    page.isFloorPlan !== false && inferIsFloorPlanFromOcr(page.ocrMeta);
  const ocrUnitIds = pickUnitIdsFromPage(page);
  return {
    pageId: page.id,
    pageNumber: page.pageNumber,
    levelName,
    levelIndex,
    floorId: page.floorId ?? `floor-${page.id}`,
    documentId: page.documentId,
    sourceFileName: page.sourceFileName ?? sourceFileName ?? null,
    isFloorPlan,
    widthPx: page.widthPx,
    heightPx: page.heightPx,
    ocrUnitIds,
  };
}

/** Display name for the building root in the hierarchy tree. */
export function resolveBuildingName(args: {
  projectName?: string | null;
  pages?: PlanPage[];
  sourceFileName?: string | null;
}): string {
  const project = args.projectName?.trim();
  if (project) return project;

  for (const page of args.pages ?? []) {
    const title = page.ocrMeta?.title?.trim();
    if (!title) continue;
    if (parseLevelName(title)) continue;
    if (/floor\s+plan|unit\s+plan|general\s+arrangement|\bga\s+plan\b/i.test(title)) continue;
    return title;
  }

  const file = args.sourceFileName?.trim();
  if (file) return file.replace(/\.[^.]+$/, "") || file;
  return "Building";
}
