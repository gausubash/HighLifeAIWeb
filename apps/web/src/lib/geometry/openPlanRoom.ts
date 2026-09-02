export type OpenPlanKind = "living" | "dining" | "kitchen";

function fold(text: string): { spaced: string; compact: string } {
  const spaced = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ")
    .replace(/[_./\\|:-]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { spaced, compact: spaced.replace(/\s+/g, "") };
}

export function openPlanKindsFromText(text: string): OpenPlanKind[] {
  const { spaced, compact } = fold(text);
  if (!spaced && !compact) return [];
  const kinds: OpenPlanKind[] = [];
  if (compact === "ldk" || /(^| )ldk( |$)/.test(spaced)) {
    return ["living", "dining", "kitchen"];
  }
  if (
    /(^| )(open living|living|lounge|family)( |$)/.test(spaced) ||
    compact.includes("living") ||
    compact === "lounge" ||
    compact === "family"
  ) {
    kinds.push("living");
  }
  if (/\b(dining)\b/.test(spaced) || compact.includes("dining")) kinds.push("dining");
  if (/\b(kitchen|kit)\b/.test(spaced) || compact.includes("kitchen") || compact === "kit") {
    kinds.push("kitchen");
  }
  return kinds;
}

export function formatOpenPlanLabel(kinds: Iterable<OpenPlanKind>): string | null {
  const set = new Set(kinds);
  const living = set.has("living");
  const dining = set.has("dining");
  const kitchen = set.has("kitchen");
  if (living && dining && kitchen) return "Living / Dining / Kitchen";
  if (living && dining) return "Living / Dining";
  if (living && kitchen) return "Living / Kitchen";
  if (dining && kitchen) return "Kitchen / Dining";
  if (living) return "Open Living";
  if (kitchen) return "Kitchen";
  if (dining) return "Dining";
  return null;
}

export function mergeOpenPlanLabels(...labels: Array<string | null | undefined>): string | null {
  const kinds = new Set<OpenPlanKind>();
  for (const label of labels) {
    if (!label) continue;
    for (const kind of openPlanKindsFromText(label)) kinds.add(kind);
  }
  return formatOpenPlanLabel(kinds);
}

export function isOpenPlanLabel(label: string): boolean {
  return openPlanKindsFromText(label).length > 0;
}
