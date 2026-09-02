import type { PolicyPack, PolicyRule } from "@highlife/shared-types";
import { parsePolicyPack } from "./parsePolicyPack";

function num(text: string): number | null {
  const m = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/**
 * Conservative keyword scrape when no LLM is configured.
 * Prefers published RDS/BADS/ADG phrasing; skips unclear numbers.
 */
export function extractPolicyFromText(text: string, fileName?: string): PolicyPack {
  const notes: string[] = [];
  const rules: PolicyRule[] = [];
  const blob = text.replace(/\s+/g, " ");

  const tryJson = text.trim();
  if (tryJson.startsWith("{") || tryJson.startsWith("[")) {
    try {
      return parsePolicyPack(JSON.parse(tryJson), fileName);
    } catch {
      notes.push("File looked like JSON but did not parse; used text extraction.");
    }
  }

  const studio = blob.match(/studio[^.]{0,80}?(\d+(?:\.\d+)?)\s*m/i);
  const oneBed = blob.match(/1[-\s]?bed(?:room)?[^.]{0,80}?(\d+(?:\.\d+)?)\s*m/i);
  const twoBed = blob.match(/2[-\s]?bed(?:room)?[^.]{0,80}?(\d+(?:\.\d+)?)\s*m/i);
  const threeBed = blob.match(/3[-\s]?bed(?:room)?[^.]{0,80}?(\d+(?:\.\d+)?)\s*m/i);
  if (studio || oneBed || twoBed || threeBed) {
    rules.push({
      code: "RDS-APT-SIZE",
      name: "Minimum internal apartment area",
      kind: "apartment_min_internal",
      clause: "Extracted dwelling size",
      requiresScale: true,
      byBedrooms: {
        "0": num(studio?.[1] ?? "") ?? 35,
        "1": num(oneBed?.[1] ?? "") ?? 50,
        "2": num(twoBed?.[1] ?? "") ?? 70,
        "3": num(threeBed?.[1] ?? "") ?? 90,
      },
      sourceText: (studio ?? oneBed ?? twoBed ?? threeBed)?.[0],
      explanation: "{label}: internal {measured} m² is below {required} m² for a {beds}-bed dwelling.",
    });
  }

  const bedArea = blob.match(/bedroom[^.]{0,60}?(\d+(?:\.\d+)?)\s*(?:m²|m2|sqm)/i);
  if (bedArea) {
    rules.push({
      code: "RDS-BED-MIN",
      name: "Minimum bedroom area",
      kind: "apartment_min_bedroom",
      requiresScale: true,
      minAreaM2: num(bedArea[1]) ?? 9,
      sourceText: bedArea[0],
      explanation: "{label} bedroom {measured} m² is below the {required} m² minimum.",
    });
  }

  const living = blob.match(/living[^.]{0,60}?(\d+(?:\.\d+)?)\s*(?:m²|m2|sqm)/i);
  if (living) {
    rules.push({
      code: "RDS-LIVING-MIN",
      name: "Minimum living area",
      kind: "apartment_min_living",
      requiresScale: true,
      minAreaM2: num(living[1]) ?? 12,
      sourceText: living[0],
      explanation: "{label}: living {measured} m² is below {required} m² for a {beds}-bed dwelling.",
    });
  }

  const pos = blob.match(
    /(?:private open space|balcony)[^.]{0,80}?(\d+(?:\.\d+)?)\s*(?:m²|m2|sqm)/i,
  );
  if (pos) {
    const v = num(pos[1]) ?? 8;
    rules.push({
      code: "RDS-POS-MIN",
      name: "Private open space",
      kind: "apartment_min_pos",
      requiresScale: true,
      byBedrooms: { "0": v, "1": v, "2": v, "3": v },
      sourceText: pos[0],
      explanation: "{label}: private open space {measured} m² is below {required} m².",
    });
  }

  if (/dual aspect|windows on two sides|natural ventilation/i.test(blob)) {
    rules.push({
      code: "RDS-ASPECT-DUAL",
      name: "Natural ventilation / dual aspect",
      kind: "apartment_dual_aspect",
      sourceText: "dual aspect / natural ventilation",
      explanation: "{label}: windows are not on two sides (or north/window data is missing).",
    });
  }

  if (/habitable.{0,50}window|bedroom.{0,40}window|each room.{0,30}window/i.test(blob)) {
    rules.push({
      code: "RDS-HAB-WINDOW",
      name: "Habitable room has an exterior window",
      kind: "habitable_has_window",
      sourceText: "habitable room window",
      explanation: "{label}: habitable rooms without an exterior window: {missing}.",
    });
  }

  if (/storage|wardrobe|robe/i.test(blob)) {
    rules.push({
      code: "RDS-STORAGE",
      name: "In-dwelling storage",
      kind: "apartment_min_storage",
      minCount: 1,
      sourceText: "storage",
      explanation: "{label}: no dedicated store / robe space labelled on the plan.",
    });
  }

  const communal = blob.match(
    /communal[^.]{0,80}?(\d+(?:\.\d+)?)\s*(?:m²|m2|sqm).{0,40}(?:dwelling|apartment)/i,
  );
  if (communal) {
    rules.push({
      code: "RDS-COMMUNAL",
      name: "Communal outdoor open space",
      kind: "communal_open_space",
      requiresScale: true,
      m2PerDwelling: num(communal[1]) ?? 2.5,
      sourceText: communal[0],
      explanation: "Communal outdoor space {measured} m² is below {required} m².",
    });
  }

  if (!rules.length) {
    notes.push(
      "No numeric apartment rules were recognised. Review the PDF or upload a JSON pack. The built-in VIC RDS pack can be used in the meantime.",
    );
  }

  const stem = fileName?.replace(/\.[^.]+$/, "") || "uploaded-policy";
  return {
    id: `pdf:${stem}:${Date.now()}`,
    version: stem.replace(/\s+/g, "_").toLowerCase(),
    name: stem,
    description: "Converted from uploaded policy text. Review thresholds before relying on them.",
    source: { kind: "pdf", fileName },
    notes,
    rules,
    createdAt: new Date().toISOString(),
  };
}
