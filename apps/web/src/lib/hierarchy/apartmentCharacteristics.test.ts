import { describe, expect, it } from "vitest";
import type { BuildingHierarchy } from "@highlife/shared-types";
import type { OverlayEntity } from "@/features/plan-editor/types";
import { areaM2FromPx, classifyRoomLabel, computeApartmentSheet } from "./apartmentCharacteristics";

function overlay(over: Partial<OverlayEntity> & { id: string; type: OverlayEntity["type"] }): OverlayEntity {
  return {
    layer: "rooms",
    geometry: { kind: "polygon", points: [] },
    label: over.label ?? over.type,
    confidence: 1,
    status: "predicted",
    source: "model",
    attributes: {},
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const hierarchy: BuildingHierarchy = {
  schemaVersion: "1.0.0",
  buildingId: "b",
  projectId: "p",
  analysisId: "a",
  name: "T",
  floors: [],
  units: [
    {
      id: "u1",
      label: "Unit 1",
      areaM2: null,
      roomIds: ["bed", "bath", "wc", "liv", "bal"],
      bedroomCount: 1,
      bathroomCount: 1,
      confidence: 0.9,
      reviewRequired: false,
    },
  ],
  rooms: [
    { id: "bed", label: "Bedroom", roomType: "Bedroom", unitId: "u1", isCommon: false, confidence: 1, objectIds: [] },
    { id: "bath", label: "Ensuite", roomType: "Ensuite", unitId: "u1", isCommon: false, confidence: 1, objectIds: [] },
    { id: "wc", label: "Toilet", roomType: "Toilet", unitId: "u1", isCommon: false, confidence: 1, objectIds: [] },
    { id: "liv", label: "Open Living", roomType: "Open Living", unitId: "u1", isCommon: false, confidence: 1, objectIds: [] },
    { id: "bal", label: "Balcony", roomType: "Balcony", unitId: "u1", isCommon: false, confidence: 1, objectIds: [] },
  ],
  objects: [],
  createdAt: "",
  updatedAt: "",
};

function square(id: string, x: number, label: string): OverlayEntity {
  return overlay({
    id,
    type: "room",
    label,
    geometry: {
      kind: "polygon",
      points: [
        { x, y: 0 },
        { x: x + 10, y: 0 },
        { x: x + 10, y: 10 },
        { x, y: 10 },
      ],
    },
  });
}

describe("classifyRoomLabel", () => {
  it("splits ensuite baths from a separate WC", () => {
    expect(classifyRoomLabel("Ensuite")).toBe("bathroom");
    expect(classifyRoomLabel("Toilet")).toBe("toilet");
    expect(classifyRoomLabel("Bedroom 2")).toBe("bedroom");
    expect(classifyRoomLabel("Balcony")).toBe("balcony");
  });
});

describe("computeApartmentSheet", () => {
  it("counts rooms and splits internal vs balcony area", () => {
    const entities = [
      square("bed", 0, "Bedroom"),
      square("bath", 10, "Ensuite"),
      square("wc", 20, "Toilet"),
      square("liv", 30, "Open Living"),
      square("bal", 40, "Balcony"),
    ];
    const sheet = computeApartmentSheet({
      hierarchy,
      entities,
      pixelsPerMeter: 10,
    });
    const apt = sheet.apartments[0];
    expect(apt.bedroomCount).toBe(1);
    expect(apt.detectedBedroomCount).toBe(1);
    expect(apt.apartmentType).toBeNull();
    expect(apt.bathroomCount).toBe(1);
    expect(apt.separateToiletCount).toBe(1);
    expect(apt.internalAreaM2).toBeCloseTo(4, 5);
    expect(apt.balconyAreaM2).toBeCloseTo(1, 5);
    expect(apt.mainAspect).toBeNull();
  });

  it("leaves areas null without scale", () => {
    expect(areaM2FromPx(100, null)).toBeNull();
    const sheet = computeApartmentSheet({ hierarchy, entities: [], pixelsPerMeter: null });
    expect(sheet.apartments[0].internalAreaM2).toBeNull();
    expect(sheet.warnings.some((w) => /scale/i.test(w))).toBe(true);
  });

  it("reads Apartment / Type / 3B from digital title-block text", () => {
    const box = (x: number, y: number): [number, number][] => [
      [x, y],
      [x + 80, y],
      [x + 80, y + 14],
      [x, y + 14],
    ];
    const fromTitle = computeApartmentSheet({
      hierarchy: { ...hierarchy, units: [] },
      entities: [],
      pixelsPerMeter: 10,
      ocrLines: [
        { text: "Apartment 56", bbox: box(800, 40) },
        { text: "Type", bbox: box(800, 58) },
        { text: "3B", bbox: box(800, 76) },
      ],
    });
    expect(fromTitle.apartments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Apartment 56",
          apartmentType: "3B",
          bedroomCount: 3,
        }),
      ]),
    );

    const attached = computeApartmentSheet({
      hierarchy: {
        ...hierarchy,
        units: [{ ...hierarchy.units[0], label: "Unit 56", roomIds: [] }],
      },
      entities: [],
      pixelsPerMeter: 10,
      ocrLines: [
        { text: "Apartment 56", bbox: box(800, 40) },
        { text: "Type", bbox: box(800, 58) },
        { text: "2B", bbox: box(800, 76) },
      ],
    });
    expect(attached.apartments[0].apartmentType).toBe("2B");
    expect(attached.apartments[0].bedroomCount).toBe(2);
  });
});
