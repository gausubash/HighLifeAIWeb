import { describe, expect, it } from "vitest";
import { overlaysToLabelMe, parseLabelMeJson } from "./labelme";
import { makeLabeledEntity } from "./labelClasses";
import { placeCompassKeypointOnEntity } from "./compassKeypointAnnotate";

describe("LabelMe compass keypoints", () => {
  it("round-trips tip and base on a north arrow", () => {
    const drawn = placeCompassKeypointOnEntity(
      placeCompassKeypointOnEntity(
        makeLabeledEntity(
          "North Arrow",
          { kind: "rect", x: 8, y: 8, width: 4, height: 32 },
          "manual",
          "2026-01-01T00:00:00.000Z",
        ),
        "base",
        { x: 10, y: 38 },
      ),
      "tip",
      { x: 10, y: 10 },
    );
    const doc = overlaysToLabelMe([drawn], {
      imagePath: "page.png",
      imageWidth: 100,
      imageHeight: 80,
    });
    expect(doc.shapes).toHaveLength(1);
    expect(doc.shapes[0].flags.keypoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "tip", x: 10, y: 10 }),
        expect.objectContaining({ name: "base", x: 10, y: 38 }),
      ]),
    );

    const parsed = parseLabelMeJson(doc);
    expect(parsed.entities).toHaveLength(1);
    expect(parsed.entities[0].type).toBe("north_arrow");
    const keypoints = parsed.entities[0].attributes.keypoints as Array<{ name: string; x: number }>;
    expect(keypoints.find((k) => k.name === "tip")?.x).toBe(10);
    expect(keypoints.find((k) => k.name === "base")?.x).toBe(10);
  });

  it("attaches sibling tip/base point shapes to the nearest north arrow", () => {
    const parsed = parseLabelMeJson({
      version: "5.8.3",
      flags: {},
      imagePath: "page.png",
      imageData: null,
      imageWidth: 100,
      imageHeight: 80,
      shapes: [
        {
          label: "North Arrow",
          shape_type: "rectangle",
          points: [
            [8, 8],
            [12, 40],
          ],
          group_id: 1,
          description: "",
          flags: {},
        },
        {
          label: "tip",
          shape_type: "point",
          points: [[10, 10]],
          group_id: 1,
          description: "",
          flags: { visibility: "visible" },
        },
        {
          label: "base",
          shape_type: "point",
          points: [[10, 38]],
          group_id: 1,
          description: "",
          flags: { occluded: true },
        },
      ],
    });
    expect(parsed.entities).toHaveLength(1);
    const keypoints = parsed.entities[0].attributes.keypoints as Array<{
      name: string;
      visibility: string;
    }>;
    expect(keypoints.find((k) => k.name === "tip")?.visibility).toBe("visible");
    expect(keypoints.find((k) => k.name === "base")?.visibility).toBe("occluded");
  });
});
