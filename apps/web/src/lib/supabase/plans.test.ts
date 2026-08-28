import { describe, expect, it } from "vitest";
import { derivePlanStoragePath } from "./plans";

describe("derivePlanStoragePath", () => {
  it("derives analysis folder from a stored page image ref", () => {
    expect(
      derivePlanStoragePath("sb:plans/user-1/proj-2/analysis-3/page-1.png"),
    ).toBe("user-1/proj-2/analysis-3");
  });

  it("returns null for non-storage refs", () => {
    expect(derivePlanStoragePath("idb:analysis:1")).toBeNull();
  });
});
