import { isPlausibleUnitId, parseUnitIds } from "./pageLevel";

export type ApartmentTypeLine = {
  text?: string | null;
  bbox?: [number, number][] | null;
};

export type ApartmentTypeHit = {
  unitId: string | null;
  apartmentType: string;
  bedroomCount: number;
};

type Box = { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number; w: number; h: number };

type Item = {
  text: string;
  box: Box | null;
  unitId: string | null;
  typeInline: ApartmentTypeHit | null;
  typeLabel: boolean;
  bedroom: ApartmentTypeHit | null;
};

const UNIT_PREFIX_ONLY_RE = /^(?:unit|apt|apartment|dwelling|tenancy|flat|suite)\.?$/i;
const BARE_UNIT_ID_RE = /^#?\s*([A-Z]?\d{1,4}[A-Z]?|\d{1,4}[A-Z])$/i;

function boxOf(bbox: [number, number][] | null | undefined): Box | null {
  if (!bbox?.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const pt of bbox) {
    const x = pt[0];
    const y = pt[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  if (!Number.isFinite(x0)) return null;
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w, h };
}

export function apartmentUnitKey(label: string | null | undefined): string {
  return (label ?? "")
    .trim()
    .toUpperCase()
    .replace(/^(?:UNIT|APT|APARTMENT|DWELLING|FLAT|SUITE)\s+/i, "")
    .replace(/\s+/g, "");
}

export function parseBedroomTypeToken(text: string | null | undefined): ApartmentTypeHit | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;
  const compact = raw.toUpperCase().replace(/[\s._-]+/g, "");
  if (compact === "STUDIO" || compact === "STU") {
    return { unitId: null, apartmentType: "Studio", bedroomCount: 0 };
  }
  const m = compact.match(/^([1-6])(?:BED(?:ROOMS?)?|BR|B)(?:\+S)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return { unitId: null, apartmentType: `${n}B`, bedroomCount: n };
}

function isTypeLabel(text: string): boolean {
  return /^types?[:.]?$/i.test(text.trim());
}

function inlineType(text: string): ApartmentTypeHit | null {
  const m = text.trim().match(/^types?[:.\s]+(.+)$/i);
  if (!m) return null;
  return parseBedroomTypeToken(m[1]);
}

/** e.g. `Unit 29 Type 2B`, `Apartment 56 - 3B`. */
function unitAndTypeInline(text: string): ApartmentTypeHit | null {
  const m = text
    .trim()
    .match(
      /^(?:unit|apt|apartment|dwelling|flat|suite)\.?\s*#?\s*([A-Z]?\d{1,4}[A-Z]?)\s*(?:[-–,/]|type\s*[:.]?\s*|\s+)(studio|\d+\s*b)$/i,
    );
  if (!m) return null;
  const typed = parseBedroomTypeToken(m[2]);
  if (!typed) return null;
  return { ...typed, unitId: m[1].toUpperCase() };
}

function unitIdFromLine(text: string): string | null {
  if (text.includes(":")) return null;
  return parseUnitIds(text, 1)[0] ?? null;
}

function bareUnitId(text: string): string | null {
  const m = BARE_UNIT_ID_RE.exec(text.trim());
  if (!m) return null;
  const uid = m[1].toUpperCase();
  return isPlausibleUnitId(uid) ? uid : null;
}

function toItem(line: ApartmentTypeLine): Item | null {
  const text = line.text?.trim() ?? "";
  if (!text) return null;
  return {
    text,
    box: boxOf(line.bbox),
    unitId: unitIdFromLine(text),
    typeInline: inlineType(text),
    typeLabel: isTypeLabel(text),
    bedroom: parseBedroomTypeToken(text),
  };
}

function joinPrefixNumbers(items: Item[]): Item[] {
  const out: Item[] = [];
  for (let i = 0; i < items.length; i++) {
    const cur = items[i];
    const next = items[i + 1];
    if (UNIT_PREFIX_ONLY_RE.test(cur.text) && next) {
      const uid = next.unitId ?? bareUnitId(next.text);
      if (uid) {
        out.push({ ...cur, text: `${cur.text} ${next.text}`, unitId: uid });
        i += 1;
        continue;
      }
    }
    out.push(cur);
  }
  return out;
}

function sortReadingOrder(items: Item[]): Item[] {
  return [...items].sort((a, b) => {
    const ay = a.box?.cy ?? 0;
    const by = b.box?.cy ?? 0;
    const ah = Math.max(a.box?.h ?? 12, b.box?.h ?? 12, 12);
    if (Math.abs(ay - by) > ah * 0.55) return ay - by;
    return (a.box?.cx ?? 0) - (b.box?.cx ?? 0);
  });
}

function belowType(type: Item, candidate: Item): boolean {
  if (!type.box || !candidate.box) return false;
  if (candidate.box.cy <= type.box.cy) return false;
  const gap = candidate.box.y0 - type.box.y1;
  if (gap > Math.max(type.box.h, 12) * 8) return false;
  const overlap = Math.min(type.box.x1, candidate.box.x1) - Math.max(type.box.x0, candidate.box.x0);
  const col = overlap > 0 || Math.abs(candidate.box.cx - type.box.cx) <= Math.max(type.box.w, candidate.box.w, 24);
  return col;
}

function hitKey(hit: ApartmentTypeHit): string {
  return `${hit.unitId ?? ""}|${hit.apartmentType}|${hit.bedroomCount}`;
}

/** Title-block apartment type (`Apartment 56` / `Type` / `3B`). */
export function parseApartmentTypesFromLines(lines: ApartmentTypeLine[] | null | undefined): ApartmentTypeHit[] {
  const items = joinPrefixNumbers((lines ?? []).map(toItem).filter((row): row is Item => Boolean(row)));
  if (!items.length) return [];
  const ordered = items.some((row) => row.box) ? sortReadingOrder(items) : items;
  const hits: ApartmentTypeHit[] = [];
  let lastUnit: string | null = null;
  let awaitingType = false;

  for (const item of ordered) {
    if (item.unitId) lastUnit = item.unitId;
    const combined = unitAndTypeInline(item.text);
    if (combined) {
      hits.push(combined);
      awaitingType = false;
      continue;
    }
    if (item.typeInline) {
      hits.push({ ...item.typeInline, unitId: lastUnit });
      awaitingType = false;
      continue;
    }
    if (item.typeLabel) {
      awaitingType = true;
      continue;
    }
    if (awaitingType && item.bedroom) {
      hits.push({ ...item.bedroom, unitId: lastUnit });
      awaitingType = false;
    }
  }

  for (const type of ordered) {
    if (!type.typeLabel) continue;
    const bed = ordered
      .filter((row) => row.bedroom && belowType(type, row))
      .sort((a, b) => (a.box?.y0 ?? 0) - (b.box?.y0 ?? 0))[0];
    if (!bed?.bedroom) continue;
    const unit =
      [...ordered]
        .reverse()
        .find((row) => row.unitId && row.box && type.box && row.box.cy <= type.box.cy && belowType(row, type))
        ?.unitId ?? lastUnit;
    hits.push({ ...bed.bedroom, unitId: unit ?? lastUnit });
  }

  const seen = new Set<string>();
  const unique: ApartmentTypeHit[] = [];
  for (const hit of hits) {
    const key = hitKey(hit);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(hit);
  }
  return unique;
}

export function matchApartmentType(
  unitLabel: string,
  hits: ApartmentTypeHit[],
  unitCount: number,
): ApartmentTypeHit | null {
  if (!hits.length) return null;
  const key = apartmentUnitKey(unitLabel);
  const exact = hits.find((hit) => hit.unitId && apartmentUnitKey(hit.unitId) === key);
  if (exact) return exact;
  if (unitCount === 1) return hits[0];
  return null;
}

export function ocrLinesFromPage(page: {
  ocrMeta?: { lines?: ApartmentTypeLine[] | null } | null;
  drawingOcrMeta?: { lines?: ApartmentTypeLine[] | null } | null;
} | null | undefined): ApartmentTypeLine[] {
  return [...(page?.ocrMeta?.lines ?? []), ...(page?.drawingOcrMeta?.lines ?? [])];
}
