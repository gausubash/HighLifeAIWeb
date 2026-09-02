import { pointInPolygon } from "@/features/plan-editor/geometry";
import type { DrawingOcrLine } from "@/lib/hierarchy/inferUnitBoundaries";
import { ocrTextToRoomLabel } from "./matchOcrRoomLabels";
import { parseOcrRoomSize, type ParsedRoomSize } from "./parseOcrRoomSize";
import type { ExtractedGeometryRoom, Pt } from "./wallBoundedRooms";

type Box = { x0: number; y0: number; x1: number; y1: number };

export type OcrRoomSizeMark = ParsedRoomSize & {
  centroid: Pt;
  box: Box;
};

function bboxOf(points: [number, number][]): Box | null {
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

function boxCenter(box: Box): Pt {
  return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
}

function unionBox(a: Box, b: Box): Box {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

function pointInRing(pt: Pt, ring: Pt[]): boolean {
  return pointInPolygon({ x: pt.x, y: pt.y }, ring.map((p) => ({ x: p.x, y: p.y })));
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

function markFromLine(text: string, box: Box, size: ParsedRoomSize): OcrRoomSizeMark {
  return { ...size, box, centroid: boxCenter(box) };
}

function isSizeFragment(text: string): boolean {
  return /\d/.test(text) || /^[x×*]$/i.test(text) || /^(m|mm)$/i.test(text);
}

function sameRow(a: Box, b: Box): boolean {
  const h = Math.max(a.y1 - a.y0, b.y1 - b.y0, 6);
  const vOverlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  const cyDiff = Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
  return vOverlap > h * 0.2 || cyDiff < h * 0.85;
}

function clusterSizeFragments(frags: { text: string; box: Box }[]): OcrRoomSizeMark[] {
  if (!frags.length) return [];
  const sorted = [...frags].sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
  const rows: { text: string; box: Box }[][] = [];
  for (const frag of sorted) {
    const row = rows.find((items) => {
      const last = items[items.length - 1];
      if (!last || !sameRow(last.box, frag.box)) return false;
      const gap = frag.box.x0 - last.box.x1;
      const h = Math.max(last.box.y1 - last.box.y0, frag.box.y1 - frag.box.y0, 6);
      return gap >= -h * 0.6 && gap <= h * 3.5;
    });
    if (row) row.push(frag);
    else rows.push([frag]);
  }

  const marks: OcrRoomSizeMark[] = [];
  const used = new Set<{ text: string; box: Box }>();
  for (const row of rows) {
    if (row.length < 2) continue;
    const joined = row.map((f) => f.text).join(" ");
    const size = parseOcrRoomSize(joined);
    if (!size) continue;
    for (const frag of row) used.add(frag);
    marks.push(markFromLine(joined, row.reduce((acc, f) => unionBox(acc, f.box), row[0].box), size));
  }

  const leftover = sorted.filter((f) => !used.has(f) && /\d/.test(f.text));
  for (let i = 0; i < leftover.length; i++) {
    for (let j = i + 1; j < leftover.length; j++) {
      const a = leftover[i];
      const b = leftover[j];
      const hOverlap = Math.min(a.box.x1, b.box.x1) - Math.max(a.box.x0, b.box.x0);
      const minW = Math.max(6, Math.min(a.box.x1 - a.box.x0, b.box.x1 - b.box.x0));
      const gap = Math.abs(b.box.y0 - a.box.y1);
      const h = Math.max(a.box.y1 - a.box.y0, b.box.y1 - b.box.y0, 6);
      if (hOverlap < minW * 0.2 || gap > h * 2.4) continue;
      const joined = parseOcrRoomSize(`${a.text} ${b.text}`);
      if (!joined) continue;
      marks.push(markFromLine(`${a.text} ${b.text}`, unionBox(a.box, b.box), joined));
      leftover.splice(j, 1);
      leftover.splice(i, 1);
      i -= 1;
      break;
    }
  }
  return marks;
}

function isSizeBelowName(name: Box, mark: Box): boolean {
  const nameH = Math.max(6, name.y1 - name.y0);
  const nameW = Math.max(6, name.x1 - name.x0);
  const markW = Math.max(6, mark.x1 - mark.x0);
  const hOverlap = Math.min(name.x1, mark.x1) - Math.max(name.x0, mark.x0);
  const gap = mark.y0 - name.y1;
  const cxDiff = Math.abs((mark.x0 + mark.x1) / 2 - (name.x0 + name.x1) / 2);
  const aligned = hOverlap > Math.min(nameW, markW) * 0.15 || cxDiff < Math.max(nameW, markW) * 0.9;
  return aligned && gap >= -nameH * 0.6 && gap <= Math.max(56, nameH * 4.5);
}

function extractLineMarks(lines: DrawingOcrLine[]): {
  names: { label: string; text: string; centroid: Pt; box: Box; size: ParsedRoomSize | null }[];
  marks: OcrRoomSizeMark[];
} {
  const leftovers: { text: string; box: Box }[] = [];
  const names: { label: string; text: string; centroid: Pt; box: Box; size: ParsedRoomSize | null }[] = [];
  const marks: OcrRoomSizeMark[] = [];

  for (const line of lines) {
    const text = line.text?.trim();
    const box = line.bbox ? bboxOf(line.bbox) : null;
    if (!text || !box) continue;

    const label = ocrTextToRoomLabel(text);
    const size = parseOcrRoomSize(text);
    if (label) {
      names.push({ label, text, centroid: boxCenter(box), box, size });
      continue;
    }
    if (size) {
      marks.push(markFromLine(text, box, size));
      continue;
    }
    if (isSizeFragment(text)) leftovers.push({ text, box });
  }

  marks.push(...clusterSizeFragments(leftovers));
  return { names, marks };
}

function pairSizesToNames(
  names: { box: Box; size: ParsedRoomSize | null }[],
  marks: OcrRoomSizeMark[],
): { paired: Array<ParsedRoomSize | null>; usedMark: Set<number> } {
  const paired: Array<ParsedRoomSize | null> = names.map((n) => n.size);
  const usedMark = new Set<number>();

  for (let i = 0; i < names.length; i++) {
    if (paired[i]) continue;
    let best = -1;
    let bestScore = Infinity;
    for (let j = 0; j < marks.length; j++) {
      if (usedMark.has(j)) continue;
      if (!isSizeBelowName(names[i].box, marks[j].box)) continue;
      const gap = Math.max(0, marks[j].box.y0 - names[i].box.y1);
      const cxDiff = Math.abs(marks[j].centroid.x - (names[i].box.x0 + names[i].box.x1) / 2);
      const score = gap + cxDiff * 0.35;
      if (score < bestScore) {
        bestScore = score;
        best = j;
      }
    }
    if (best < 0) continue;
    usedMark.add(best);
    paired[i] = marks[best];
  }

  return { paired, usedMark };
}

function roomsContaining(pt: Pt, rooms: ExtractedGeometryRoom[]): ExtractedGeometryRoom[] {
  return rooms
    .filter((room) => room.points.length >= 3 && pointInRing(pt, room.points))
    .sort((a, b) => a.areaPx2 - b.areaPx2);
}

function findRoomForPoint(pt: Pt, rooms: ExtractedGeometryRoom[], maxDist = 80): ExtractedGeometryRoom | null {
  const inside = roomsContaining(pt, rooms);
  if (inside[0]) return inside[0];
  let best: ExtractedGeometryRoom | null = null;
  let bestD = Infinity;
  for (const room of rooms) {
    const c = roomCentroid(room);
    const d = Math.hypot(pt.x - c.x, pt.y - c.y);
    if (d < bestD) {
      bestD = d;
      best = room;
    }
  }
  return bestD <= maxDist ? best : null;
}

function applySize(room: ExtractedGeometryRoom, size: ParsedRoomSize): ExtractedGeometryRoom {
  return {
    ...room,
    labeledWidthM: size.widthM,
    labeledDepthM: size.depthM,
    labeledSizeText: size.text,
    widthM: size.widthM,
    depthM: size.depthM,
    areaM2: roundArea(size.widthM * size.depthM),
  };
}

function roundArea(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Attach printed OCR sizes (under Bedroom, Living, …) to geometry rooms. */
export function applyOcrRoomDimensions(
  rooms: ExtractedGeometryRoom[],
  lines: DrawingOcrLine[] | null | undefined,
): ExtractedGeometryRoom[] {
  if (!rooms.length || !lines?.length) return rooms;

  const { names, marks } = extractLineMarks(lines);

  const { paired, usedMark } = pairSizesToNames(names, marks);
  const byRoom = new Map<string, ParsedRoomSize>();

  for (let i = 0; i < names.length; i++) {
    const size = paired[i];
    if (!size) continue;
    const room = findRoomForPoint(names[i].centroid, rooms);
    if (!room || byRoom.has(room.id)) continue;
    byRoom.set(room.id, size);
  }

  for (let j = 0; j < marks.length; j++) {
    if (usedMark.has(j)) continue;
    const room = roomsContaining(marks[j].centroid, rooms)[0];
    if (!room || byRoom.has(room.id)) continue;
    byRoom.set(room.id, marks[j]);
  }

  if (!byRoom.size) return rooms;
  return rooms.map((room) => {
    const size = byRoom.get(room.id);
    return size ? applySize(room, size) : room;
  });
}

export function extractOcrRoomSizeMarks(lines: DrawingOcrLine[] | null | undefined): OcrRoomSizeMark[] {
  if (!lines?.length) return [];
  return extractLineMarks(lines).marks;
}
