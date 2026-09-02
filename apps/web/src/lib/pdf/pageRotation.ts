import type { OverlayEntity, OverlayGeometry } from "@/features/plan-editor/types";

export type PageRotationDeg = 0 | 90 | 180 | 270;

export const PAGE_ROTATION_OPTIONS: { deg: PageRotationDeg; label: string }[] = [
  { deg: 0, label: "None (as in file)" },
  { deg: 90, label: "90° clockwise" },
  { deg: 180, label: "180°" },
  { deg: 270, label: "90° counter-clockwise" },
];

export function normalizeRotation(value: number): PageRotationDeg {
  const turned = ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  if (turned === 90 || turned === 180 || turned === 270) return turned;
  return 0;
}

export function asPageRotation(value: unknown): PageRotationDeg | null {
  if (value === 0 || value === 90 || value === 180 || value === 270) return value;
  return null;
}

/**
 * Viewer turn applied after the PDF page /Rotate flag.
 * Prefer the stored value; if missing, infer a 90° CW swap when the raster
 * orientation no longer matches the PDF page.
 */
export function inferViewerRotation(args: {
  stored?: unknown;
  pdfWidth: number;
  pdfHeight: number;
  pageWidthPx: number;
  pageHeightPx: number;
}): PageRotationDeg {
  const stored = asPageRotation(args.stored);
  if (stored != null) return stored;
  const pdfLandscape = args.pdfWidth > args.pdfHeight + 1;
  const pageLandscape = args.pageWidthPx > args.pageHeightPx + 1;
  if (pdfLandscape === pageLandscape) return 0;
  return 90;
}

export function rotatedSize(
  width: number,
  height: number,
  deg: PageRotationDeg,
): { width: number; height: number } {
  return deg === 90 || deg === 270 ? { width: height, height: width } : { width, height };
}

/** Clockwise rotation in the page's pixel space (origin top-left). */
export function rotatePoint(
  x: number,
  y: number,
  width: number,
  height: number,
  deg: PageRotationDeg,
): { x: number; y: number } {
  if (deg === 90) return { x: height - y, y: x };
  if (deg === 180) return { x: width - x, y: height - y };
  if (deg === 270) return { x: y, y: width - x };
  return { x, y };
}

export function rotateGeometry(
  geometry: OverlayGeometry,
  width: number,
  height: number,
  deg: PageRotationDeg,
): OverlayGeometry {
  if (deg === 0) return geometry;
  if (geometry.kind === "point") {
    const p = rotatePoint(geometry.x, geometry.y, width, height, deg);
    return { kind: "point", x: p.x, y: p.y };
  }
  if (geometry.kind === "rect") {
    const a = rotatePoint(geometry.x, geometry.y, width, height, deg);
    const b = rotatePoint(
      geometry.x + geometry.width,
      geometry.y + geometry.height,
      width,
      height,
      deg,
    );
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return {
      kind: "rect",
      x,
      y,
      width: Math.abs(b.x - a.x),
      height: Math.abs(b.y - a.y),
    };
  }
  return {
    ...geometry,
    points: geometry.points.map((p) => rotatePoint(p.x, p.y, width, height, deg)),
  };
}

export function rotateOverlayEntity(
  entity: OverlayEntity,
  width: number,
  height: number,
  deg: PageRotationDeg,
): OverlayEntity {
  if (deg === 0) return entity;
  return {
    ...entity,
    geometry: rotateGeometry(entity.geometry, width, height, deg),
    updatedAt: new Date().toISOString(),
  };
}

export function scaleGeometry(
  geometry: OverlayGeometry,
  scaleX: number,
  scaleY: number,
): OverlayGeometry {
  if (geometry.kind === "point") {
    return { kind: "point", x: geometry.x * scaleX, y: geometry.y * scaleY };
  }
  if (geometry.kind === "rect") {
    return {
      kind: "rect",
      x: geometry.x * scaleX,
      y: geometry.y * scaleY,
      width: geometry.width * scaleX,
      height: geometry.height * scaleY,
    };
  }
  return {
    ...geometry,
    points: geometry.points.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY })),
  };
}

export function scaleOverlayEntity(
  entity: OverlayEntity,
  scaleX: number,
  scaleY: number,
): OverlayEntity {
  if (scaleX === 1 && scaleY === 1) return entity;
  return {
    ...entity,
    geometry: scaleGeometry(entity.geometry, scaleX, scaleY),
    updatedAt: new Date().toISOString(),
  };
}
