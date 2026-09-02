import { describe, expect, it } from "vitest";
import { HOOPER_APARTMENT_RULES_V1 } from "./builtinPacks";
import {
  formatHooperThreshold,
  isHooperApartmentRulesDoc,
  packFromHooperApartmentRules,
  titleFromHooperId,
} from "./hooperApartmentRules";
import { parsePolicyPack } from "./parsePolicyPack";
import { complianceRules } from "./evaluatePolicy";
import { explainGuideline, graphicForGuideline } from "./policyExplain";
import source from "./data/apartment_rules_complete.json";

describe("hooper apartment rules pack", () => {
  it("ingests all 122 rows as the default pack", () => {
    expect(HOOPER_APARTMENT_RULES_V1.id).toBe("hooper_apartment_rules_v1");
    expect(HOOPER_APARTMENT_RULES_V1.guidelines).toHaveLength(122);
    expect(source.rules).toHaveLength(122);
    expect(new Set(HOOPER_APARTMENT_RULES_V1.guidelines?.map((g) => g.group)).size).toBe(10);
    expect(HOOPER_APARTMENT_RULES_V1.guidelines?.every((g) => g.status === "accepted")).toBe(true);
    expect(HOOPER_APARTMENT_RULES_V1.guidelines?.every((g) => g.text.length > 10)).toBe(true);
  });

  it("maps a plan-checkable subset", () => {
    const kinds = HOOPER_APARTMENT_RULES_V1.rules.map((r) => r.kind).sort();
    expect(kinds).toEqual([
      "apartment_dual_aspect",
      "apartment_min_internal",
      "apartment_min_living",
      "apartment_min_bedroom",
      "apartment_min_pos",
      "apartment_min_storage",
      "communal_open_space",
      "habitable_has_window",
    ].sort());
    expect(complianceRules(HOOPER_APARTMENT_RULES_V1)).toHaveLength(8);
  });

  it("describes every guideline with a graphic", () => {
    for (const guideline of HOOPER_APARTMENT_RULES_V1.guidelines ?? []) {
      const rule = HOOPER_APARTMENT_RULES_V1.rules.find((r) => r.guidelineId === guideline.id);
      const explain = explainGuideline(guideline, rule);
      expect(explain.summary.length).toBeGreaterThan(10);
      expect(explain.how.length).toBeGreaterThan(0);
      expect(graphicForGuideline(guideline)).toBeTruthy();
    }
  });

  it("parses the raw Hooper JSON as a pack", () => {
    expect(isHooperApartmentRulesDoc(source)).toBe(true);
    const pack = parsePolicyPack(source, "apartment_rules_complete.json");
    expect(pack.guidelines).toHaveLength(122);
    expect(pack.rules.length).toBe(8);
  });

  it("formats titles and thresholds", () => {
    expect(titleFromHooperId("studio_min_35m2")).toMatch(/Studio/i);
    expect(formatHooperThreshold(">=", 0.7, "fraction")).toBe(">= 70%");
    expect(formatHooperThreshold("==", 1, "boolean")).toBe("Required");
  });

  it("keeps upload ingest pending until review", () => {
    const pack = packFromHooperApartmentRules(source, { fileName: "upload.json" });
    expect(pack.guidelines?.every((g) => g.status === "pending")).toBe(true);
  });
});
