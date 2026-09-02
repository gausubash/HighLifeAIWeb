import { describe, expect, it } from "vitest";
import {
  formatOpenPlanLabel,
  mergeOpenPlanLabels,
  openPlanKindsFromText,
} from "./openPlanRoom";

describe("openPlanKindsFromText", () => {
  it("reads living, dining, and kitchen in any case", () => {
    expect(openPlanKindsFromText("LIVING")).toEqual(["living"]);
    expect(openPlanKindsFromText("Dining")).toEqual(["dining"]);
    expect(openPlanKindsFromText("KITCHEN")).toEqual(["kitchen"]);
  });

  it("reads combined open-plan names", () => {
    expect(openPlanKindsFromText("LIVING / DINING")).toEqual(["living", "dining"]);
    expect(openPlanKindsFromText("Kitchen Living")).toEqual(["living", "kitchen"]);
    expect(openPlanKindsFromText("LDK")).toEqual(["living", "dining", "kitchen"]);
  });
});

describe("formatOpenPlanLabel", () => {
  it("names combined rooms", () => {
    expect(formatOpenPlanLabel(["living"])).toBe("Open Living");
    expect(formatOpenPlanLabel(["living", "dining"])).toBe("Living / Dining");
    expect(formatOpenPlanLabel(["living", "kitchen"])).toBe("Living / Kitchen");
    expect(formatOpenPlanLabel(["dining", "kitchen"])).toBe("Kitchen / Dining");
    expect(formatOpenPlanLabel(["living", "dining", "kitchen"])).toBe("Living / Dining / Kitchen");
  });
});

describe("mergeOpenPlanLabels", () => {
  it("unions nearby living dining kitchen names", () => {
    expect(mergeOpenPlanLabels("LIVING", "DINING", "KITCHEN")).toBe("Living / Dining / Kitchen");
    expect(mergeOpenPlanLabels("Open Living", "Kitchen")).toBe("Living / Kitchen");
  });
});
