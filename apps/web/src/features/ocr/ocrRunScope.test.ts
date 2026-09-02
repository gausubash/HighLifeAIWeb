import { describe, expect, it } from "vitest";
import { ocrRunFromChecks } from "./ocrRunScope";

describe("ocrRunFromChecks", () => {
  it("does nothing when neither title nor drawing is selected", () => {
    expect(
      ocrRunFromChecks({ title: false, drawing: false, allPages: true, pageNumber: 2 }),
    ).toBeNull();
  });

  it("runs title and drawing on the current page by default", () => {
    expect(
      ocrRunFromChecks({ title: true, drawing: true, allPages: false, pageNumber: 3 }),
    ).toEqual({ kind: "both", targetPages: [3], applyScale: true });
  });

  it("runs title and drawing on every page when All is checked", () => {
    expect(
      ocrRunFromChecks({ title: true, drawing: true, allPages: true, pageNumber: 3 }),
    ).toEqual({ kind: "both", targetPages: undefined, applyScale: true });
  });

  it("runs title only on every page when Title and All are checked", () => {
    expect(
      ocrRunFromChecks({ title: true, drawing: false, allPages: true, pageNumber: 1 }),
    ).toEqual({ kind: "title_block", targetPages: undefined, applyScale: true });
  });

  it("runs drawing only on the current page when Drawing is checked", () => {
    expect(
      ocrRunFromChecks({ title: false, drawing: true, allPages: false, pageNumber: 4 }),
    ).toEqual({ kind: "drawing", targetPages: [4], applyScale: false });
  });
});
