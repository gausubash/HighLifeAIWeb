import { describe, expect, it } from "vitest";
import type { OverlayGeometry } from "@/features/plan-editor/types";
import {
  buildRoomGraph,
  doorPathExists,
  egoNeighborhood,
  habitableMissingWindows,
  isHabitableRoomLabel,
  toSceneRelationships,
  unitHasCrossVentPath,
} from "./roomGraph";
import type { ExtractedGeometryRoom, GeometryInputEntity } from "./wallBoundedRooms";

function rectGeom(x: number, y: number, w: number, h: number): OverlayGeometry {
  return { kind: "rect", x, y, width: w, height: h };
}

function room(
  id: string,
  label: string,
  x: number,
  y: number,
  w: number,
  h: number,
): ExtractedGeometryRoom {
  return {
    id,
    label,
    unitId: "u37",
    unitLabel: "Unit 37",
    isCommon: false,
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
    areaPx2: w * h,
    widthPx: Math.max(w, h),
    depthPx: Math.min(w, h),
    perimeterPx: 2 * (w + h),
    areaM2: (w * h) / 100,
    widthM: Math.max(w, h) / 10,
    depthM: Math.min(w, h) / 10,
    perimeterM: (2 * (w + h)) / 10,
    adjacentIds: [],
    adjacentLabels: [],
    openings: { doors: [], windows: [] },
  };
}

function opening(id: string, type: "door" | "window", label: string, x: number, y: number, w: number, h: number): GeometryInputEntity {
  return { id, type, label, geometry: rectGeom(x, y, w, h) };
}

describe("roomGraph", () => {
  const bed = room("bed", "Bedroom", 0, 0, 50, 60);
  const liv = room("liv", "Open Living", 50, 0, 50, 60);
  const door = opening("d1", "door", "Single Door", 46, 26, 8, 8);
  const winBed = opening("w1", "window", "Window", 0, 20, 3, 16);
  const winLiv = opening("w2", "window", "Window", 97, 20, 3, 16);

  it("classifies habitable rooms", () => {
    expect(isHabitableRoomLabel("Bedroom")).toBe(true);
    expect(isHabitableRoomLabel("Open Living")).toBe(true);
    expect(isHabitableRoomLabel("Bathroom")).toBe(false);
    expect(isHabitableRoomLabel("Store")).toBe(false);
  });

  it("links adjacent rooms with a shared wall and a door", () => {
    const graph = buildRoomGraph({
      rooms: [bed, liv],
      openings: [door, winBed, winLiv],
      pixelsPerMeter: 10,
    });
    expect(graph.edges.some((e) => e.kind === "shared_wall")).toBe(true);
    expect(graph.edges.some((e) => e.kind === "door" && e.fromId === "bed" && e.toId === "liv")).toBe(true);
    expect(graph.edges.filter((e) => e.kind === "window_exterior")).toHaveLength(2);
    expect(doorPathExists(graph, "bed", "liv")).toBe(true);
    expect(unitHasCrossVentPath(graph, "u37", "Unit 37")).toBe(true);
    const rels = toSceneRelationships(graph);
    expect(rels.some((r) => r.type === "room_adjacency")).toBe(true);
    expect(rels.some((r) => r.type === "room_door_access")).toBe(true);
    expect(rels.some((r) => r.type === "room_window_exterior")).toBe(true);
  });

  it("flags a habitable room with no exterior window", () => {
    const graph = buildRoomGraph({
      rooms: [bed, liv],
      openings: [door, winLiv],
      pixelsPerMeter: 10,
    });
    const missing = habitableMissingWindows(graph, "u37", "Unit 37");
    expect(missing.map((r) => r.label)).toEqual(["Bedroom"]);
    const ego = egoNeighborhood(graph, "bed");
    expect(ego?.habitable).toBe(true);
    expect(ego?.hasExteriorWindow).toBe(false);
    expect(egoNeighborhood(graph, "liv")?.hasExteriorWindow).toBe(true);
  });
});
