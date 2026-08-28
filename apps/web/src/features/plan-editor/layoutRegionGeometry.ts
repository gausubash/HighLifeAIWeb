import type { Point } from "@highlife/shared-types";
import type { OverlayEntity, OverlayGeometry } from "./types";
import { geometryBBox } from "./types";

export type ResizeHandle = "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se";

export type LayoutRect = { x: number; y: number; width: number; height: number };

const MIN_SIZE = 8;

export function layoutGeometryToRect(geometry: OverlayGeometry): Extract<OverlayGeometry, { kind: "rect" }> {
  if (geometry.kind === "rect") {
    return {
      kind: "rect",
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
    };
  }
  const b = geometryBBox(geometry);
  return { kind: "rect", x: b.x, y: b.y, width: b.width, height: b.height };
}

export function layoutEntityToRect(entity: OverlayEntity): OverlayEntity {
  return {
    ...entity,
    geometry: layoutGeometryToRect(entity.geometry),
  };
}

export function applyResizeHandle(start: LayoutRect, handle: ResizeHandle, pt: Point): LayoutRect {
  let { x, y, width, height } = start;
  const right = x + width;
  const bottom = y + height;

  if (handle.includes("w")) {
    x = Math.min(pt.x, right - MIN_SIZE);
    width = right - x;
  }
  if (handle.includes("e")) {
    const newRight = Math.max(pt.x, x + MIN_SIZE);
    width = newRight - x;
  }
  if (handle.includes("n")) {
    y = Math.min(pt.y, bottom - MIN_SIZE);
    height = bottom - y;
  }
  if (handle.includes("s")) {
    const newBottom = Math.max(pt.y, y + MIN_SIZE);
    height = newBottom - y;
  }

  return {
    x,
    y,
    width: Math.max(MIN_SIZE, width),
    height: Math.max(MIN_SIZE, height),
  };
}

export function resizeHandleCenters(rect: LayoutRect): { handle: ResizeHandle; x: number; y: number }[] {
  const { x, y, width, height } = rect;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const right = x + width;
  const bottom = y + height;
  return [
    { handle: "nw", x, y },
    { handle: "n", x: cx, y },
    { handle: "ne", x: right, y },
    { handle: "w", x, y: cy },
    { handle: "e", x: right, y: cy },
    { handle: "sw", x, y: bottom },
    { handle: "s", x: cx, y: bottom },
    { handle: "se", x: right, y: bottom },
  ];
}

export function hitResizeHandle(
  pt: Point,
  rect: LayoutRect,
  tolerance: number,
): ResizeHandle | null {
  for (const { handle, x, y } of resizeHandleCenters(rect)) {
    if (Math.hypot(pt.x - x, pt.y - y) <= tolerance) return handle;
  }
  return null;
}

export function cursorForResizeHandle(handle: ResizeHandle): string {
  if (handle === "n" || handle === "s") return "ns-resize";
  if (handle === "e" || handle === "w") return "ew-resize";
  if (handle === "nw" || handle === "se") return "nwse-resize";
  return "nesw-resize";
}
