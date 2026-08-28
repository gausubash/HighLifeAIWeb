import { describe, expect, it } from "vitest";
import { buildStoreZipBytes } from "./storeZip";

describe("store zip", () => {
  it("writes local and central headers for stored files", () => {
    const bytes = buildStoreZipBytes([
      { name: "page.json", data: new TextEncoder().encode('{"shapes":[]}') },
      { name: "page.png", data: new Uint8Array([137, 80, 78, 71]) },
    ]);
    const asText = new TextDecoder().decode(bytes);
    expect(asText).toContain("page.json");
    expect(asText).toContain("page.png");
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
  });
});
