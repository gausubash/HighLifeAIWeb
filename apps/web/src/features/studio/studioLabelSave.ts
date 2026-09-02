import { overlaysToLabelMe } from "@/features/plan-editor/labelme";
import type { OverlayEntity } from "@/features/plan-editor/types";
import type { MlDataset, StudioPage } from "@/lib/studio/types";

export type AnnotateSaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

export function labelShapesFingerprint(shapes: unknown): string {
  return JSON.stringify(shapes);
}

export function buildPageLabelDoc(
  entities: OverlayEntity[],
  page: Pick<StudioPage, "id" | "width_px" | "height_px">,
) {
  return overlaysToLabelMe(entities, {
    imagePath: `${page.id}.png`,
    imageWidth: page.width_px,
    imageHeight: page.height_px,
  });
}

export function applyLabeledPage(dataset: MlDataset, updated: StudioPage): MlDataset {
  const pages = dataset.pages.map((item) =>
    item.id === updated.id
      ? {
          ...item,
          labeled: updated.labeled,
          shape_count: updated.shape_count,
          labels_path: updated.labels_path,
        }
      : item,
  );
  return {
    ...dataset,
    pages,
    labeled_count: pages.filter((item) => item.labeled).length,
  };
}

export function pageSaveKey(datasetId: string, pageId: string): string {
  return `${datasetId}:${pageId}`;
}
