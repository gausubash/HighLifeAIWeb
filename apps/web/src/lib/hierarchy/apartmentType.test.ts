import { describe, expect, it } from "vitest";
import {
  matchApartmentType,
  parseApartmentTypesFromLines,
  parseBedroomTypeToken,
} from "./apartmentType";

function line(text: string, x = 0, y = 0, w = 80, h = 14): { text: string; bbox: [number, number][] } {
  return {
    text,
    bbox: [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
  };
}

describe("parseBedroomTypeToken", () => {
  it("reads 2B / 3B / studio", () => {
    expect(parseBedroomTypeToken("3B")).toEqual({ unitId: null, apartmentType: "3B", bedroomCount: 3 });
    expect(parseBedroomTypeToken("2b")).toEqual({ unitId: null, apartmentType: "2B", bedroomCount: 2 });
    expect(parseBedroomTypeToken("1 Bed")).toEqual({ unitId: null, apartmentType: "1B", bedroomCount: 1 });
    expect(parseBedroomTypeToken("Studio")).toEqual({
      unitId: null,
      apartmentType: "Studio",
      bedroomCount: 0,
    });
  });

  it("ignores unit ids and other abbreviations", () => {
    expect(parseBedroomTypeToken("12B")).toBeNull();
    expect(parseBedroomTypeToken("TYPE")).toBeNull();
    expect(parseBedroomTypeToken("NB")).toBeNull();
    expect(parseBedroomTypeToken("B")).toBeNull();
  });
});

describe("parseApartmentTypesFromLines", () => {
  it("pairs Apartment 56 stacked above Type and 3B", () => {
    const hits = parseApartmentTypesFromLines([
      line("Apartment 56", 800, 40),
      line("Type", 800, 58),
      line("3B", 800, 76),
    ]);
    expect(hits).toEqual([{ unitId: "56", apartmentType: "3B", bedroomCount: 3 }]);
  });

  it("joins a split Apartment / 56 then Type / 2B", () => {
    const hits = parseApartmentTypesFromLines([
      line("Apartment", 10, 10, 90),
      line("56", 10, 28, 40),
      line("Type", 10, 46, 40),
      line("2B", 10, 64, 40),
    ]);
    expect(hits).toEqual([{ unitId: "56", apartmentType: "2B", bedroomCount: 2 }]);
  });

  it("reads Type 3B on one line", () => {
    expect(parseApartmentTypesFromLines([line("Apartment 12", 0, 0), line("Type 3B", 0, 20)])).toEqual([
      { unitId: "12", apartmentType: "3B", bedroomCount: 3 },
    ]);
  });

  it("reads Unit 29 Type 2B on one line from drawing OCR", () => {
    expect(parseApartmentTypesFromLines([line("Unit 29 Type 2B", 200, 400)])).toEqual([
      { unitId: "29", apartmentType: "2B", bedroomCount: 2 },
    ]);
  });

  it("does not treat a lone 3B as a type", () => {
    expect(parseApartmentTypesFromLines([line("3B"), line("BED 1")])).toEqual([]);
  });
});

describe("matchApartmentType", () => {
  const hit = { unitId: "56", apartmentType: "3B" as const, bedroomCount: 3 };

  it("matches Unit 56 and Apartment 56", () => {
    expect(matchApartmentType("Unit 56", [hit], 2)?.apartmentType).toBe("3B");
    expect(matchApartmentType("Apartment 56", [hit], 2)?.bedroomCount).toBe(3);
  });

  it("applies a single sheet type to the only unit", () => {
    expect(matchApartmentType("Unit 1", [{ unitId: null, apartmentType: "2B", bedroomCount: 2 }], 1)?.apartmentType).toBe(
      "2B",
    );
  });
});
