export type ParsedRoomSize = {
  widthM: number;
  depthM: number;
  text: string;
};

const SIZE_PAIR =
  /(\d+(?:[.,]\d+)?)\s*(mm|m)?\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(mm|m)?/i;

function parseNum(raw: string): number {
  return Number.parseFloat(raw.replace(",", "."));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatSize(widthM: number, depthM: number): string {
  const fmt = (n: number) => {
    const rounded = round2(n);
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
  };
  return `${fmt(widthM)} × ${fmt(depthM)} m`;
}

function toMeters(n: number, unit: string, otherUnit: string, otherN: number): number {
  if (unit === "mm") return n / 1000;
  if (unit === "m") return n;
  if (otherUnit === "mm") return n / 1000;
  if (otherUnit === "m") return n;
  if (n >= 50 && otherN >= 50) return n / 1000;
  return n;
}

function plausibleRoomSize(a: number, b: number, hasUnit: boolean): boolean {
  if (a < 0.8 || b < 0.8 || a > 30 || b > 30) return false;
  if (hasUnit) return true;
  const bothInt = Number.isInteger(round2(a)) && Number.isInteger(round2(b));
  // Bare integers like "2 x 4" are usually notes, not room sizes.
  return !bothInt;
}

/** Parse printed room sizes such as `3.9m x 3.9 m`, `3.9 × 3.9`, or `3900 x 3900`. */
export function parseOcrRoomSize(text: string): ParsedRoomSize | null {
  const raw = text.trim();
  if (!raw || raw.length > 80) return null;
  if (/1\s*:\s*\d/.test(raw)) return null;

  const match = raw.match(SIZE_PAIR);
  if (!match) return null;

  const a = parseNum(match[1]);
  const b = parseNum(match[3]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;

  const unitA = (match[2] ?? "").toLowerCase();
  const unitB = (match[4] ?? "").toLowerCase();
  const hasUnit = Boolean(unitA || unitB);
  const widthM = toMeters(a, unitA, unitB, b);
  const depthM = toMeters(b, unitB, unitA, a);

  if (!plausibleRoomSize(widthM, depthM, hasUnit || (a >= 50 && b >= 50))) return null;

  return {
    widthM: round2(widthM),
    depthM: round2(depthM),
    text: formatSize(widthM, depthM),
  };
}
