import { describe, expect, it } from "vitest";
import { parseOcrRoomSize } from "./parseOcrRoomSize";

describe("parseOcrRoomSize", () => {
  it("parses metres next to a room name", () => {
    expect(parseOcrRoomSize("3.9m x 3.9 m")).toEqual({
      widthM: 3.9,
      depthM: 3.9,
      text: "3.9 × 3.9 m",
    });
    expect(parseOcrRoomSize("Bedroom 3.9 × 3.9")).toMatchObject({ widthM: 3.9, depthM: 3.9 });
  });

  it("parses millimetre pairs", () => {
    expect(parseOcrRoomSize("3900 x 3600")).toEqual({
      widthM: 3.9,
      depthM: 3.6,
      text: "3.9 × 3.6 m",
    });
    expect(parseOcrRoomSize("3900mm x 3900mm")).toMatchObject({ widthM: 3.9, depthM: 3.9 });
  });

  it("ignores scale and implausible sizes", () => {
    expect(parseOcrRoomSize("1:100")).toBeNull();
    expect(parseOcrRoomSize("Scale 1 : 50")).toBeNull();
    expect(parseOcrRoomSize("12.5 m²")).toBeNull();
    expect(parseOcrRoomSize("2 x 4")).toBeNull();
  });
});
