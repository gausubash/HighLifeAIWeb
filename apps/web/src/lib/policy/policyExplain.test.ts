import { describe, expect, it } from "vitest";
import { HOOPER_APARTMENT_RULES_V1, RDS_VIC_APARTMENTS_V1 } from "./builtinPacks";
import { bedroomBandLabel, explainPolicyRule, ruleBands } from "./policyExplain";

describe("policyExplain", () => {
  it("labels bedroom bands", () => {
    expect(bedroomBandLabel("0")).toBe("Studio");
    expect(bedroomBandLabel("1")).toBe("1 bed");
    expect(bedroomBandLabel("3")).toBe("3+ bed");
  });

  it("explains apartment size with the pack thresholds", () => {
    const rule = RDS_VIC_APARTMENTS_V1.rules.find((r) => r.code === "RDS-APT-SIZE");
    expect(rule).toBeTruthy();
    const explain = explainPolicyRule(rule!);
    expect(explain.graphic).toBe("apartment_size");
    expect(explain.summary).toContain("35");
    expect(explain.summary).toContain("90");
    expect(ruleBands(rule!)).toEqual([
      { key: "0", label: "Studio", value: 35 },
      { key: "1", label: "1 bed", value: 50 },
      { key: "2", label: "2 bed", value: 70 },
      { key: "3", label: "3+ bed", value: 90 },
    ]);
  });

  it("covers every built-in rule kind", () => {
    for (const pack of [RDS_VIC_APARTMENTS_V1, HOOPER_APARTMENT_RULES_V1]) {
      for (const rule of pack.rules) {
        const explain = explainPolicyRule(rule);
        expect(explain.summary.length).toBeGreaterThan(40);
        expect(explain.how.length).toBeGreaterThan(0);
      }
    }
  });
});
