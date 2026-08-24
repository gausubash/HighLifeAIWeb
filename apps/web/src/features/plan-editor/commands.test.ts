import { describe, expect, it } from "vitest";
import { applyCommand, undoCommand, type OverlayCommand } from "./commands";
import type { OverlayEntity } from "./types";

function ent(id: string, label: string): OverlayEntity {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id,
    type: "wall",
    layer: "walls",
    geometry: { kind: "polyline", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] },
    label,
    confidence: 1,
    status: "user_edited",
    source: "manual",
    attributes: {},
    createdAt: now,
    updatedAt: now,
  };
}

describe("overlay commands", () => {
  it("adds and undoes an entity", () => {
    const a = ent("a", "A");
    const cmd: OverlayCommand = { type: "add", entity: a };
    const after = applyCommand([], cmd);
    expect(after).toHaveLength(1);
    expect(undoCommand(after, cmd)).toHaveLength(0);
  });

  it("updates and restores previous entity", () => {
    const a = ent("a", "A");
    const b = { ...a, label: "B" };
    const cmd: OverlayCommand = { type: "update", id: "a", before: a, after: b };
    const after = applyCommand([a], cmd);
    expect(after[0].label).toBe("B");
    expect(undoCommand(after, cmd)[0].label).toBe("A");
  });

  it("removes and restores entities", () => {
    const a = ent("a", "A");
    const b = ent("b", "B");
    const cmd: OverlayCommand = { type: "remove", entities: [a] };
    const after = applyCommand([a, b], cmd);
    expect(after.map((e) => e.id)).toEqual(["b"]);
    expect(undoCommand(after, cmd).map((e) => e.id).sort()).toEqual(["a", "b"]);
  });
});
