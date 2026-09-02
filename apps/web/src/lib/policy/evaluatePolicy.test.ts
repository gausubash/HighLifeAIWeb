import { describe, expect, it } from "vitest";
import type { ApartmentSheet, BuildingHierarchy } from "@highlife/shared-types";
import type { OverlayEntity } from "@/features/plan-editor/types";
import { RDS_VIC_APARTMENTS_V1 } from "./builtinPacks";
import { bedroomBand, complianceRules, evaluatePolicyPack, thresholdByBedrooms } from "./evaluatePolicy";

function apt(over: Partial<ApartmentSheet["apartments"][0]> = {}): ApartmentSheet["apartments"][0] {
  return {
    unitId: "u1",
    label: "U01",
    apartmentType: null,
    bedroomCount: 1,
    detectedBedroomCount: 1,
    bathroomCount: 1,
    separateToiletCount: 0,
    internalAreaM2: 55,
    balconyAreaM2: 9,
    courtyardAreaM2: null,
    mainAspect: "N",
    mainAspectDeg: 0,
    primaryWindowLongM: 3,
    aspectKind: "dual",
    windowsOnTwoSides: true,
    northArrowId: "n1",
    primaryWindowId: "w1",
    evidenceIds: ["u1"],
    confidence: 0.9,
    reviewStatus: "ok",
    ...over,
  };
}

function sheet(apartments: ApartmentSheet["apartments"], communal = 20): ApartmentSheet {
  return {
    apartments,
    communalOutdoor: {
      present: communal > 0,
      areaM2: communal,
      location: "podium",
      evidenceIds: communal > 0 ? ["c1"] : [],
    },
    pixelsPerMeter: 100,
    warnings: [],
  };
}

describe("bedroom bands", () => {
  it("maps studio through 3+", () => {
    expect(bedroomBand(0)).toBe("0");
    expect(bedroomBand(3)).toBe("3");
    expect(thresholdByBedrooms({ "0": 35, "1": 50, "2": 70, "3": 90 }, 1)).toBe(50);
    expect(thresholdByBedrooms({ "0": 35, "1": 50, "2": 70, "3": 90 }, 4)).toBe(90);
  });
});

describe("evaluatePolicyPack RDS", () => {
  it("passes a compliant 1-bed apartment", () => {
    const checks = evaluatePolicyPack({
      pack: RDS_VIC_APARTMENTS_V1,
      analysisId: "a1",
      sheet: sheet([apt()]),
    });
    const size = checks.find((c) => c.ruleCode === "RDS-APT-SIZE");
    const pos = checks.find((c) => c.ruleCode === "RDS-POS-MIN");
    const bath = checks.find((c) => c.ruleCode === "RDS-BATH-MIN");
    const aspect = checks.find((c) => c.ruleCode === "RDS-ASPECT-DUAL");
    expect(size?.result).toBe("pass");
    expect(pos?.result).toBe("pass");
    expect(bath?.result).toBe("pass");
    expect(aspect?.result).toBe("pass");
  });

  it("fails undersized internal area and missing POS", () => {
    const checks = evaluatePolicyPack({
      pack: RDS_VIC_APARTMENTS_V1,
      analysisId: "a1",
      sheet: sheet([
        apt({
          internalAreaM2: 40,
          balconyAreaM2: null,
          courtyardAreaM2: null,
          bathroomCount: 0,
          windowsOnTwoSides: false,
          aspectKind: "single",
        }),
      ]),
    });
    expect(checks.find((c) => c.ruleCode === "RDS-APT-SIZE")?.result).toBe("fail");
    expect(checks.find((c) => c.ruleCode === "RDS-POS-MIN")?.result).toBe("fail");
    expect(checks.find((c) => c.ruleCode === "RDS-BATH-MIN")?.result).toBe("fail");
    expect(checks.find((c) => c.ruleCode === "RDS-ASPECT-DUAL")?.result).toBe("fail");
  });

  it("defers metric rules without scale", () => {
    const checks = evaluatePolicyPack({
      pack: RDS_VIC_APARTMENTS_V1,
      analysisId: "a1",
      sheet: { ...sheet([apt()]), pixelsPerMeter: null },
    });
    const metric = checks.filter((c) =>
      ["RDS-APT-SIZE", "RDS-BED-MIN", "RDS-LIVING-MIN", "RDS-POS-MIN", "RDS-COMMUNAL"].includes(
        c.ruleCode,
      ),
    );
    expect(metric.every((c) => c.result === "uncertain")).toBe(true);
  });

  it("checks bedroom polygons against 9 m²", () => {
    const hierarchy: BuildingHierarchy = {
      schemaVersion: "1.0.0",
      buildingId: "b",
      projectId: "p",
      analysisId: "a1",
      name: "T",
      floors: [],
      units: [
        {
          id: "u1",
          label: "U01",
          roomIds: ["bed"],
          bedroomCount: 1,
          bathroomCount: 1,
          confidence: 1,
          reviewRequired: false,
        },
      ],
      rooms: [
        {
          id: "bed",
          label: "Bedroom",
          roomType: "bedroom",
          unitId: "u1",
          isCommon: false,
          confidence: 1,
          objectIds: [],
        },
      ],
      objects: [],
      createdAt: "",
      updatedAt: "",
    };
    const entities: OverlayEntity[] = [
      {
        id: "bed",
        type: "room",
        layer: "rooms",
        geometry: { kind: "rect", x: 0, y: 0, width: 200, height: 200 },
        label: "Bedroom",
        confidence: 0.9,
        status: "user_confirmed",
        source: "model",
        attributes: {},
        createdAt: "",
        updatedAt: "",
      },
    ];
    // 200x200 px at 100 px/m → 4 m²
    const checks = evaluatePolicyPack({
      pack: RDS_VIC_APARTMENTS_V1,
      analysisId: "a1",
      sheet: sheet([apt()]),
      hierarchy,
      entities,
    });
    const bed = checks.find((c) => c.ruleCode === "RDS-BED-MIN");
    expect(bed?.result).toBe("fail");
    expect(bed?.measuredValue).toBeCloseTo(4, 5);
  });

  it("fails habitable rooms that have no exterior window on the geometry graph", () => {
    const graph = {
      nodes: [
        {
          id: "bed",
          label: "Bedroom",
          unitId: "u1",
          unitLabel: "U01",
          isCommon: false,
          points: [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 40 },
            { x: 0, y: 40 },
          ],
          areaPx2: 1600,
          widthPx: 40,
          depthPx: 40,
          perimeterPx: 160,
          areaM2: 16,
          widthM: 4,
          depthM: 4,
          perimeterM: 16,
          adjacentIds: [],
          adjacentLabels: [],
          openings: { doors: [], windows: [] },
        },
      ],
      edges: [],
    };
    const checks = evaluatePolicyPack({
      pack: RDS_VIC_APARTMENTS_V1,
      analysisId: "a1",
      sheet: sheet([apt()]),
      roomGraph: graph,
    });
    const win = checks.find((c) => c.ruleCode === "RDS-HAB-WINDOW");
    expect(win?.result).toBe("fail");
    expect(win?.explanation).toMatch(/Bedroom/);
  });
});

describe("complianceRules", () => {
  it("only evaluates accepted guidelines", () => {
    const pack = {
      ...RDS_VIC_APARTMENTS_V1,
      guidelines: [
        {
          id: "g-size",
          group: "Size",
          name: "Internal area",
          text: "Minimum internal area.",
          status: "accepted" as const,
          mappedKind: "apartment_min_internal" as const,
        },
        {
          id: "g-pos",
          group: "POS",
          name: "Balcony",
          text: "Private open space.",
          status: "pending" as const,
          mappedKind: "apartment_min_pos" as const,
        },
      ],
      rules: RDS_VIC_APARTMENTS_V1.rules.map((rule) =>
        rule.kind === "apartment_min_internal"
          ? { ...rule, guidelineId: "g-size" }
          : rule.kind === "apartment_min_pos"
            ? { ...rule, guidelineId: "g-pos" }
            : { ...rule, guidelineId: "g-other" },
      ),
    };
    const runnable = complianceRules(pack);
    expect(runnable.map((r) => r.kind)).toEqual(["apartment_min_internal"]);
    const checks = evaluatePolicyPack({
      pack,
      analysisId: "a1",
      sheet: sheet([apt()]),
    });
    expect(checks.every((c) => c.ruleCode === "RDS-APT-SIZE")).toBe(true);
  });
});
