import { describe, expect, it } from "vitest";
import { buildLayoutZoneRows } from "./layoutZoneRows";
import type { OverlayEntity } from "./types";

function titleBlock(id: string, label = "Title block"): OverlayEntity {
  return {
    id,
    type: "title_block",
    layer: "layout",
    label,
    confidence: 0.9,
    status: "detected",
    source: "model",
    geometry: { kind: "rect", x: 0, y: 0, width: 100, height: 80 },
    attributes: {},
    createdAt: "",
    updatedAt: "",
  };
}

describe("buildLayoutZoneRows", () => {
  it("shows one row per detected title block", () => {
    const rows = buildLayoutZoneRows([
      titleBlock("tb1"),
      titleBlock("tb2"),
      {
        id: "main",
        type: "main_floorplan",
        layer: "layout",
        label: "Main drawing",
        confidence: 0.95,
        status: "detected",
        source: "model",
        geometry: { kind: "rect", x: 0, y: 0, width: 800, height: 600 },
        attributes: {},
        createdAt: "",
        updatedAt: "",
      },
    ]);

    const titleRows = rows.filter((row) => row.type === "title_block");
    expect(titleRows).toHaveLength(2);
    expect(titleRows[0].entityId).toBe("tb1");
    expect(titleRows[1].entityId).toBe("tb2");
    expect(titleRows[0].label).toBe("Title block 1");
    expect(titleRows[1].label).toBe("Title block 2");
  });

  it("shows placeholder when no title block exists", () => {
    const rows = buildLayoutZoneRows([]);
    expect(rows.some((row) => row.type === "title_block" && !row.entityId)).toBe(true);
  });
});
