import { describe, expect, it } from "vitest";
import { canonicalLabel, entityTypeForLabel, makeLabeledEntity } from "./labelClasses";
import { overlaysToLabelMe, parseLabelMeJson } from "./labelme";

const NOW = "2026-08-25T00:00:00.000Z";

describe("label classes", () => {
  it("aliases LabelMe dump names onto HighLife classes", () => {
    expect(canonicalLabel("Toilet")).toBe("Bathroom");
    expect(canonicalLabel("Living")).toBe("Open Living");
    expect(canonicalLabel("Home Office")).toBe("Bedroom");
    expect(canonicalLabel("Scale")).toBeNull();
  });

  it("maps room and opening labels onto overlay entity types", () => {
    expect(entityTypeForLabel("Bedroom")).toBe("room");
    expect(entityTypeForLabel("Unit")).toBe("unit_boundary");
    expect(entityTypeForLabel("Sliding Door")).toBe("door");
    expect(entityTypeForLabel("External Wall")).toBe("wall");
  });
});

describe("LabelMe JSON", () => {
  it("imports polygons and 2-point rectangles", () => {
    const parsed = parseLabelMeJson(
      {
        version: "5.8.3",
        shapes: [
          {
            label: "Bedroom",
            points: [
              [10, 10],
              [80, 10],
              [80, 60],
              [10, 60],
            ],
            shape_type: "polygon",
          },
          {
            label: "Toilet",
            points: [
              [100, 20],
              [140, 50],
            ],
            shape_type: "rectangle",
          },
        ],
        imagePath: "floor.png",
        imageWidth: 200,
        imageHeight: 100,
      },
      NOW,
    );
    expect(parsed.entities).toHaveLength(2);
    expect(parsed.entities[0].label).toBe("Bedroom");
    expect(parsed.entities[0].geometry.kind).toBe("polygon");
    expect(parsed.entities[0].source).toBe("labelme");
    expect(parsed.entities[1].label).toBe("Bathroom");
    expect(parsed.entities[1].geometry).toEqual({
      kind: "rect",
      x: 100,
      y: 20,
      width: 40,
      height: 30,
    });
    expect(parsed.skipped).toBe(0);
  });

  it("round-trips overlay entities without embedding imageData", () => {
    const bedroom = makeLabeledEntity(
      "Bedroom",
      {
        kind: "polygon",
        points: [
          { x: 10, y: 10 },
          { x: 80, y: 10 },
          { x: 80, y: 60 },
          { x: 10, y: 60 },
        ],
      },
      "manual",
      NOW,
    );
    bedroom.id = "ent-bedroom";
    const door = makeLabeledEntity(
      "Single Door",
      { kind: "rect", x: 12, y: 40, width: 18, height: 6 },
      "manual",
      NOW,
    );
    door.id = "ent-door";

    const doc = overlaysToLabelMe([bedroom, door], {
      imagePath: "plan-p1.png",
      imageWidth: 400,
      imageHeight: 300,
    });
    expect(doc.imageData).toBeNull();
    expect(doc.shapes[0].shape_type).toBe("polygon");
    expect(doc.shapes[1].shape_type).toBe("rectangle");
    expect(doc.shapes[1].points).toEqual([
      [12, 40],
      [30, 46],
    ]);

    const again = parseLabelMeJson(doc, NOW);
    expect(again.entities.map((e) => e.label)).toEqual(["Bedroom", "Single Door"]);
    expect(again.entities[0].geometry.kind).toBe("polygon");
    expect(again.entities[1].geometry.kind).toBe("rect");
  });

  it("rejects JSON that is not LabelMe", () => {
    expect(() => parseLabelMeJson({ names: ["Bedroom"] })).toThrow(/LabelMe JSON/);
  });
});
