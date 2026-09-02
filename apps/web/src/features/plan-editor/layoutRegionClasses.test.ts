import { describe, expect, it } from "vitest";
import { layoutKindForZoneName } from "./layoutRegionClasses";

describe("layoutKindForZoneName", () => {
  it("maps the core drawing and title zones", () => {
    expect(layoutKindForZoneName("Main drawing")).toBe("main_floorplan");
    expect(layoutKindForZoneName("drawing area")).toBe("main_floorplan");
    expect(layoutKindForZoneName("Title block")).toBe("title_block");
  });

  it("maps information and utility zone aliases", () => {
    expect(layoutKindForZoneName("Legend")).toBe("legend");
    expect(layoutKindForZoneName("symbol legend")).toBe("legend");
    expect(layoutKindForZoneName("Production")).toBe("revision_block");
    expect(layoutKindForZoneName("revision history")).toBe("revision_block");
    expect(layoutKindForZoneName("Border")).toBe("drawing_border");
    expect(layoutKindForZoneName("margin")).toBe("drawing_border");
  });

  it("keeps distinct sheet extras as custom zones", () => {
    expect(layoutKindForZoneName("Key plan")).toBe("notes");
    expect(layoutKindForZoneName("Local labels")).toBe("notes");
    expect(layoutKindForZoneName("Dimensioning grid")).toBe("notes");
    expect(layoutKindForZoneName("Binding edge")).toBe("notes");
    expect(layoutKindForZoneName("Grid referencing")).toBe("notes");
  });
});
