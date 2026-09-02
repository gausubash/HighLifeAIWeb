import { describe, expect, it } from "vitest";
import { CLASS_SWATCH, classSwatch } from "./styles";

describe("classSwatch", () => {
  it("uses the unit purple for numbered unit labels", () => {
    expect(classSwatch("Unit")).toBe(CLASS_SWATCH.unit);
    expect(classSwatch("Unit 2")).toBe(CLASS_SWATCH.unit);
    expect(classSwatch("Unit 10A")).toBe(CLASS_SWATCH.unit);
    expect(classSwatch("unit_boundary")).toBe(CLASS_SWATCH.unit);
  });

  it("does not treat bedroom as a unit", () => {
    expect(classSwatch("Bedroom")).toBe(CLASS_SWATCH.bedroom);
  });
});
