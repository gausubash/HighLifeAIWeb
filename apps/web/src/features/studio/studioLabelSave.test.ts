import { describe, expect, it } from "vitest";
import { parseLabelMeJson } from "@/features/plan-editor/labelme";
import { makeLabeledEntity } from "@/features/plan-editor/labelClasses";
import { placeCompassKeypointOnEntity } from "@/features/plan-editor/compassKeypointAnnotate";
import { parseCompassKeypoints } from "@/lib/hierarchy/compassKeypoints";
import {
  applyLabeledPage,
  buildPageLabelDoc,
  labelShapesFingerprint,
} from "./studioLabelSave";
import type { MlDataset, StudioPage } from "@/lib/studio/types";

function page(partial: Partial<StudioPage> & Pick<StudioPage, "id">): StudioPage {
  return {
    source_name: "crop.png",
    page_number: 1,
    width_px: 190,
    height_px: 189,
    labeled: false,
    shape_count: 0,
    ...partial,
  };
}

describe("studio label save", () => {
  it("round-trips north-arrow tip and base through LabelMe flags", () => {
    const box = makeLabeledEntity("North Arrow", {
      kind: "rect",
      x: 20,
      y: 20,
      width: 80,
      height: 80,
    });
    const withTip = placeCompassKeypointOnEntity(box, "tip", { x: 60, y: 28 });
    const withBoth = placeCompassKeypointOnEntity(withTip, "base", { x: 60, y: 88 });
    const doc = buildPageLabelDoc([withBoth], page({ id: "page-1" }));
    const flags = doc.shapes[0]?.flags as { keypoints?: unknown };
    const written = parseCompassKeypoints(flags);
    expect(written.map((k) => [k.name, Math.round(k.x), Math.round(k.y)])).toEqual([
      ["tip", 60, 28],
      ["base", 60, 88],
    ]);

    const parsed = parseLabelMeJson(doc);
    const restored = parseCompassKeypoints(parsed.entities[0]?.attributes);
    expect(restored.map((k) => [k.name, Math.round(k.x), Math.round(k.y)])).toEqual([
      ["tip", 60, 28],
      ["base", 60, 88],
    ]);
    expect(labelShapesFingerprint(buildPageLabelDoc(parsed.entities, page({ id: "page-1" })).shapes)).toBe(
      labelShapesFingerprint(doc.shapes),
    );
  });

  it("updates labeled_count from the saved page", () => {
    const dataset: MlDataset = {
      id: "ds",
      name: "North crops",
      task: "pose",
      class_names: ["North Arrow"],
      pages: [page({ id: "a" }), page({ id: "b", labeled: true, shape_count: 1 })],
      image_count: 2,
      labeled_count: 1,
      ready: true,
      storage_path: null,
      created_at: "",
      updated_at: "",
    };
    const next = applyLabeledPage(dataset, page({ id: "a", labeled: true, shape_count: 1, labels_path: "a.json" }));
    expect(next.labeled_count).toBe(2);
    expect(next.pages[0]?.labels_path).toBe("a.json");
  });
});
