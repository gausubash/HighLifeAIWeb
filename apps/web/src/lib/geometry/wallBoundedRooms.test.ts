import { describe, expect, it } from "vitest";
import type { OverlayGeometry } from "@/features/plan-editor/types";
import { extractWallBoundedRooms, type GeometryInputEntity } from "./wallBoundedRooms";

function ent(
  id: string,
  type: string,
  label: string,
  geometry: OverlayGeometry,
): GeometryInputEntity {
  return { id, type, label, geometry };
}

function rect(x: number, y: number, width: number, height: number): OverlayGeometry {
  return { kind: "rect", x, y, width, height };
}

describe("extractWallBoundedRooms", () => {
  it("splits two interiors across a wall bar and majority-votes type", () => {
    const rooms = extractWallBoundedRooms({
      widthPx: 100,
      heightPx: 60,
      pixelsPerMeter: 10,
      entities: [
        ent("w1", "wall", "Wall", rect(48, 0, 4, 60)),
        ent("r1", "room", "Bedroom", rect(2, 2, 44, 56)),
        ent("r2", "room", "Bedroom", rect(4, 8, 20, 20)),
        ent("r3", "room", "Bathroom", rect(54, 2, 44, 56)),
      ],
    });
    const labels = rooms.map((r) => r.label).sort();
    expect(labels).toContain("Bedroom");
    expect(labels).toContain("Bathroom");
    const bedroom = rooms.find((r) => r.label === "Bedroom");
    expect(bedroom?.areaM2).toBeGreaterThan(1);
    expect(bedroom?.widthM).toBeGreaterThan(0);
    expect(rooms.every((r) => r.points.every((p) => p.x < 52 || p.x > 48 || r.label !== "Bedroom"))).toBe(
      true,
    );
  });

  it("does not let rooms cross a party wall between two units", () => {
    const rooms = extractWallBoundedRooms({
      widthPx: 100,
      heightPx: 60,
      pixelsPerMeter: 10,
      entities: [
        ent("u37", "unit_boundary", "Unit 37", rect(0, 0, 50, 60)),
        ent("u36", "unit_boundary", "Unit 36", rect(50, 0, 50, 60)),
        ent("party", "wall", "Wall", rect(48, 0, 4, 60)),
        ent("inner", "wall", "Wall", rect(0, 28, 48, 4)),
        ent("bed", "room", "Bedroom", rect(2, 2, 44, 24)),
        ent("bath", "room", "Bathroom", rect(2, 34, 44, 24)),
        ent("liv", "room", "Open Living", rect(54, 4, 42, 52)),
      ],
    });
    const in37 = rooms.filter((r) => r.unitLabel === "Unit 37");
    const in36 = rooms.filter((r) => r.unitLabel === "Unit 36");
    expect(in37.length).toBeGreaterThanOrEqual(2);
    expect(in36.length).toBeGreaterThanOrEqual(1);
    expect(in37.some((r) => r.label === "Bedroom")).toBe(true);
    expect(in37.some((r) => r.label === "Bathroom")).toBe(true);
    expect(in36.some((r) => r.label === "Open Living")).toBe(true);
    for (const room of in37) {
      const cx = room.points.reduce((s, p) => s + p.x, 0) / room.points.length;
      expect(cx).toBeLessThan(52);
    }
    for (const room of in36) {
      const cx = room.points.reduce((s, p) => s + p.x, 0) / room.points.length;
      expect(cx).toBeGreaterThan(48);
    }
  });

  it("converts area with pixelsPerMeter", () => {
    const rooms = extractWallBoundedRooms({
      widthPx: 40,
      heightPx: 30,
      pixelsPerMeter: 10,
      entities: [
        ent("u", "unit_boundary", "Unit 1", rect(0, 0, 40, 30)),
        ent("w", "wall", "Wall", rect(0, 14, 40, 2)),
      ],
    });
    const interior = rooms.find((r) => r.areaPx2 > 50);
    expect(interior).toBeTruthy();
    expect(interior?.areaM2).toBeGreaterThan(0.5);
    expect(interior?.widthM).toBeGreaterThan(0);
  });

  it("clips to Unit-labelled room polygons when type is still room", () => {
    const rooms = extractWallBoundedRooms({
      widthPx: 100,
      heightPx: 60,
      pixelsPerMeter: 10,
      entities: [
        ent("u37", "room", "Unit", rect(0, 0, 50, 60)),
        ent("u36", "room", "Unit", rect(50, 0, 50, 60)),
        ent("party", "wall", "Wall", rect(48, 0, 4, 60)),
        ent("inner", "wall", "Wall", rect(0, 28, 48, 4)),
        ent("bed", "room", "Bedroom", rect(2, 2, 44, 24)),
        ent("liv", "room", "Open Living", rect(54, 4, 42, 52)),
      ],
    });
    expect(rooms.some((r) => r.unitId === "u37" && r.label === "Bedroom")).toBe(true);
    expect(rooms.some((r) => r.unitId === "u36" && r.label === "Open Living")).toBe(true);
    expect(rooms.every((r) => r.unitId === "u37" || r.unitId === "u36" || r.isCommon)).toBe(true);
  });

  it("assigns overlay room polygons to units without walls", () => {
    const rooms = extractWallBoundedRooms({
      widthPx: 100,
      heightPx: 60,
      pixelsPerMeter: 10,
      entities: [
        ent("u37", "room", "Unit", rect(0, 0, 50, 60)),
        ent("bed", "room", "Bedroom", rect(4, 4, 40, 24)),
        ent("bath", "room", "Bathroom", rect(4, 32, 40, 24)),
      ],
    });
    expect(rooms).toHaveLength(2);
    expect(rooms.every((r) => r.unitId === "u37")).toBe(true);
    expect(rooms.map((r) => r.label).sort()).toEqual(["Bathroom", "Bedroom"]);
  });
});
