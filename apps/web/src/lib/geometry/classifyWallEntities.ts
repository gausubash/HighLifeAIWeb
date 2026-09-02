import { overlayGeometryPoints } from "@/features/plan-editor/geometry";
import type { OverlayGeometry } from "@/features/plan-editor/types";
import { minWidthPx, wallThicknessPx } from "@/lib/fpr/metricLayer";
import { doorOpeningSpanFromRect } from "@/lib/hierarchy/communalMainDoor";
import { isExternalWallLabel } from "@/lib/hierarchy/inferUnitBoundaries";
import type { WallClassifyMode } from "@/features/plan-editor/useWallClassificationStore";

export type WallClassification = "internal" | "external";

export type ClassifiedWall = {
  id: string;
  label: string;
  classification: WallClassification;
  thicknessPx: number;
  thicknessMm: number | null;
};

type WallEntity = {
  id: string;
  label: string;
  geometry: OverlayGeometry;
  type?: string;
  status?: string;
};

export function wallOpeningThicknessPx(entity: WallEntity): number {
  const g = entity.geometry;
  if (g.kind === "rect") {
    return doorOpeningSpanFromRect(g.width, g.height);
  }
  const pts = overlayGeometryPoints(g);
  const ribbon = wallThicknessPx(pts);
  if (ribbon > 0) return ribbon;
  return minWidthPx(pts);
}

export function classifyWallEntity(
  entity: WallEntity,
  pixelsPerMeter: number | null | undefined,
  externalMinMm: number,
  mode: WallClassifyMode,
  externalMinPx = 8,
): ClassifiedWall | null {
  if (entity.type && entity.type !== "wall") return null;
  if (entity.status === "rejected") return null;

  const thicknessPx = wallOpeningThicknessPx(entity);
  const ppm = pixelsPerMeter && pixelsPerMeter > 0 ? pixelsPerMeter : null;
  const thicknessMm = ppm ? (thicknessPx / ppm) * 1000 : null;

  const byLabel = isExternalWallLabel(entity.label);
  const byThicknessMm = thicknessMm != null && thicknessMm >= externalMinMm;
  const byThicknessPx = !ppm && thicknessPx >= externalMinPx;

  let classification: WallClassification;
  if (mode === "label") {
    classification = byLabel ? "external" : "internal";
  } else if (mode === "thickness") {
    classification = (ppm ? byThicknessMm : byThicknessPx) ? "external" : "internal";
  } else {
    classification = byLabel || (ppm ? byThicknessMm : byThicknessPx) ? "external" : "internal";
  }

  return {
    id: entity.id,
    label: entity.label,
    classification,
    thicknessPx,
    thicknessMm,
  };
}

export function classifyWallEntities(
  entities: WallEntity[],
  pixelsPerMeter: number | null | undefined,
  externalMinMm: number,
  mode: WallClassifyMode,
  externalMinPx = 8,
): ClassifiedWall[] {
  return entities
    .map((e) => classifyWallEntity(e, pixelsPerMeter, externalMinMm, mode, externalMinPx))
    .filter((w): w is ClassifiedWall => w != null);
}
