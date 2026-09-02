import { classifyRoomLabel } from "@/lib/hierarchy/apartmentCharacteristics";
import { parseBedroomTypeToken } from "@/lib/hierarchy/apartmentType";
import type { DrawingOcrLine } from "@/lib/hierarchy/inferUnitBoundaries";
import { formatOpenPlanLabel, openPlanKindsFromText } from "./openPlanRoom";
import type { ExtractedGeometryRoom, Pt } from "./wallBoundedRooms";

function centroidOfBbox(bbox: [number, number][]): Pt | null {
  if (!bbox.length) return null;
  let x = 0;
  let y = 0;
  for (const p of bbox) {
    x += p[0];
    y += p[1];
  }
  return { x: x / bbox.length, y: y / bbox.length };
}

function pointInRing(pt: Pt, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x;
    const yi = ring[i].y;
    const xj = ring[j].x;
    const yj = ring[j].y;
    const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function roomCentroid(room: ExtractedGeometryRoom): Pt {
  let x = 0;
  let y = 0;
  for (const p of room.points) {
    x += p.x;
    y += p.y;
  }
  const n = Math.max(1, room.points.length);
  return { x: x / n, y: y / n };
}

function foldOcrRoomText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ")
    .replace(/[_./\\|:-]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Apartment type tokens (3B, 2 BED…) are not room labels on the plan. */
function isApartmentTypeText(text: string): boolean {
  const raw = text.normalize("NFKC").trim();
  if (!raw) return true;
  if (parseBedroomTypeToken(raw)) return true;
  const n = foldOcrRoomText(raw);
  if (/^\d+\s*(?:bed(?:room)?s?|br|b)\b/.test(n)) return true;
  if (/^types?\b/.test(n)) return true;
  return false;
}

function parseBedroomLabelFromOcr(raw: string, n: string): string | null {
  if (isApartmentTypeText(raw)) return null;
  const compact = n.replace(/\s+/g, "");
  if (!/\b(bed(?:room)?|bdr|mbr)\b/.test(n) && !compact.startsWith("bed")) return null;

  const numbered =
    n.match(/\b(?:bed(?:room)?|bdr|mbr|br)\.?\s*#?\s*(\d+[a-z]?)\b/) ??
    n.match(/\bbed\s+(\d+[a-z]?)\b/);
  if (numbered) return `Bedroom ${numbered[1].toUpperCase()}`;

  // "3 bed" / "2 bedroom" = apartment marketing, not a room name on the drawing.
  if (/^\d+\s*(?:bed|br|bedroom)/.test(n)) return null;

  return "Bedroom";
}

/** Normalize OCR text into a room label when it names a space type. */
export function ocrTextToRoomLabel(text: string): string | null {
  const raw = text.normalize("NFKC").trim();
  if (!raw || raw.length > 160) return null;
  if (isApartmentTypeText(raw)) return null;
  const n = foldOcrRoomText(raw);
  if (!n) return null;
  const compact = n.replace(/\s+/g, "");

  const bedroom = parseBedroomLabelFromOcr(raw, n);
  if (bedroom) return bedroom;
  if (/\b(study|home office)\b/.test(n)) return "Study";
  const openPlan = formatOpenPlanLabel(openPlanKindsFromText(raw));
  if (openPlan) return openPlan;
  if (/\b(robe|wardrobe|wir|closet|walk in)\b/.test(n) || compact === "wir" || compact.includes("wardrobe")) {
    return "Robe";
  }
  if (/\b(ensuite|en suite)\b/.test(n) || compact.includes("ensuite")) return "Ensuite";
  if (/\b(bath(?:room)?)\b/.test(n) && !/\b(toilet|powder|wc)\b/.test(n)) return "Bathroom";
  if (/\b(toilet|powder|wc)\b/.test(n)) return "Toilet";
  if (/\b(laundry)\b/.test(n) || compact.includes("laundry")) return "Laundry";
  if (/\b(balcony|terrace)\b/.test(n) || compact.includes("balcony")) return "Balcony";
  if (/\b(entry|foyer|hall)\b/.test(n)) return "Entry";

  const kind = classifyRoomLabel(raw);
  if (kind === "bedroom" && !isApartmentTypeText(raw)) {
    return raw.replace(/\b(bedroom|bed)\b/i, "Bedroom").trim() || "Bedroom";
  }
  if (kind === "bathroom") return "Bathroom";
  if (kind === "balcony") return "Balcony";

  return null;
}

type LineBox = { x0: number; y0: number; x1: number; y1: number };

function bboxOfPoints(points: [number, number][]): LineBox | null {
  if (points.length < 2) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  if (!Number.isFinite(x0)) return null;
  return { x0, y0, x1, y1 };
}

function sameRow(a: LineBox, b: LineBox): boolean {
  const h = Math.max(a.y1 - a.y0, b.y1 - b.y0, 6);
  const vOverlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  const cyDiff = Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  return vOverlap > h * 0.2 || cyDiff < h * 0.85;
}

function clusterRoomNameFragments(
  frags: { text: string; centroid: Pt; box: LineBox }[],
): OcrRoomSeed[] {
  if (!frags.length) return [];
  const sorted = [...frags].sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
  const rows: typeof frags[] = [];
  for (const frag of sorted) {
    const row = rows.find((items) => {
      const last = items[items.length - 1];
      if (!last || !sameRow(last.box, frag.box)) return false;
      const gap = frag.box.x0 - last.box.x1;
      const h = Math.max(last.box.y1 - last.box.y0, frag.box.y1 - frag.box.y0, 6);
      return gap >= -h * 0.6 && gap <= h * 1.8;
    });
    if (row) row.push(frag);
    else rows.push([frag]);
  }

  const seeds: OcrRoomSeed[] = [];
  for (const row of rows) {
    if (row.length < 2) continue;
    const joinedTight = row.map((f) => f.text).join("");
    const joinedSpaced = row.map((f) => f.text).join(" ");
    const label = ocrTextToRoomLabel(joinedTight) ?? ocrTextToRoomLabel(joinedSpaced);
    if (!label) continue;
    let x = 0;
    let y = 0;
    for (const f of row) {
      x += f.centroid.x;
      y += f.centroid.y;
    }
    seeds.push({
      label,
      centroid: { x: x / row.length, y: y / row.length },
      text: joinedSpaced,
    });
  }
  return seeds;
}

export type OcrRoomSeed = { label: string; centroid: Pt; text: string };

export function extractOcrRoomSeeds(lines: DrawingOcrLine[] | null | undefined): OcrRoomSeed[] {
  const seeds: OcrRoomSeed[] = [];
  const leftovers: { text: string; centroid: Pt; box: LineBox }[] = [];
  for (const line of lines ?? []) {
    const text = line.text?.trim();
    const bbox = line.bbox;
    if (!text || !bbox || bbox.length < 2) continue;
    const centroid = centroidOfBbox(bbox);
    if (!centroid) continue;
    const label = ocrTextToRoomLabel(text);
    if (label) {
      seeds.push({ label, centroid, text });
      continue;
    }
    const box = bboxOfPoints(bbox);
    if (box) leftovers.push({ text, centroid, box });
  }
  seeds.push(...clusterRoomNameFragments(leftovers));
  return seeds;
}

/**
 * Assign OCR room labels to flood-filled geometry rooms (centroid-in-polygon or nearest).
 */
export function enrichRoomsWithOcrLabels(
  rooms: ExtractedGeometryRoom[],
  lines: DrawingOcrLine[] | null | undefined,
): ExtractedGeometryRoom[] {
  const seeds = extractOcrRoomSeeds(lines);
  if (!seeds.length) return rooms;

  const usedSeed = new Set<number>();
  const usedRoom = new Set<number>();
  const generic = (label: string) => {
    const n = label.trim().toLowerCase();
    return n === "room" || n === "space" || n === "area" || n.startsWith("room ");
  };

  const sortedSeedIdx = seeds
    .map((seed, i) => ({ seed, i }))
    .sort((a, b) => {
      const pa = a.seed.label.match(/\b(\d+)\b/) ? 0 : 1;
      const pb = b.seed.label.match(/\b(\d+)\b/) ? 0 : 1;
      return pa - pb || a.seed.label.localeCompare(b.seed.label);
    });

  const out = rooms.map((room) => ({ ...room }));

  for (const { seed, i: seedIdx } of sortedSeedIdx) {
    if (usedSeed.has(seedIdx)) continue;
    const category = seed.label.toLowerCase().includes("bed")
      ? "bedroom"
      : seed.label.toLowerCase().includes("bath")
        ? "bathroom"
        : seed.label.toLowerCase().includes("robe")
          ? "robe"
          : "other";
    const strictInside = category === "bedroom" || category === "bathroom" || category === "robe";

    let bestRoomIdx = -1;
    let bestScore = Infinity;

    for (let ri = 0; ri < out.length; ri++) {
      if (usedRoom.has(ri)) continue;
      if (!generic(out[ri].label)) continue;
      const c = roomCentroid(out[ri]);
      const inside = pointInRing(seed.centroid, out[ri].points);
      const d = Math.hypot(seed.centroid.x - c.x, seed.centroid.y - c.y);
      const score = strictInside ? (inside ? d : null) : inside ? d : d + 5000;
      if (score == null || score >= bestScore) continue;
      bestScore = score;
      bestRoomIdx = ri;
    }

    if (bestRoomIdx < 0 || bestScore > 8000) continue;
    usedSeed.add(seedIdx);
    usedRoom.add(bestRoomIdx);
    out[bestRoomIdx] = { ...out[bestRoomIdx], label: seed.label };
  }

  return out;
}
