import { describe, expect, it } from "vitest";
import { extractPolicyFromText } from "./extractPolicyFromText";
import { parsePolicyJsonText } from "./parsePolicyPack";

describe("parsePolicyJsonText", () => {
  it("normalizes snake_case YAML-style JSON", () => {
    const pack = parsePolicyJsonText(
      JSON.stringify({
        version: "custom_v1",
        name: "Custom",
        rules: [
          {
            code: "X-BED",
            name: "Bed min",
            room_labels: ["Bedroom"],
            min_area_m2: 9,
            requires_scale: true,
          },
        ],
      }),
      "custom.json",
    );
    expect(pack.rules[0].kind).toBe("room_min_area");
    expect(pack.rules[0].minAreaM2).toBe(9);
  });
});

describe("extractPolicyFromText", () => {
  it("picks bedroom and POS numbers from prose", () => {
    const pack = extractPolicyFromText(
      "Each bedroom must be at least 9 m2. Private open space should be 8 sqm with a 1.8 m dimension. Dual aspect is preferred.",
      "bads.pdf",
    );
    const kinds = pack.rules.map((r) => r.kind);
    expect(kinds).toContain("apartment_min_bedroom");
    expect(kinds).toContain("apartment_min_pos");
    expect(kinds).toContain("apartment_dual_aspect");
  });
});
