/** Clamp pan so a centered, scaled stage cannot leave the viewport box. */
export function clampPanToViewport(
  panX: number,
  panY: number,
  zoom: number,
  stageW: number,
  stageH: number,
  viewW: number,
  viewH: number,
): { x: number; y: number } {
  const scaledW = stageW * zoom;
  const scaledH = stageH * zoom;
  // When the page is smaller than or equal to the box, lock to centre.
  const maxX = Math.max(0, (scaledW - viewW) / 2);
  const maxY = Math.max(0, (scaledH - viewH) / 2);
  const x = Math.min(maxX, Math.max(-maxX, panX));
  const y = Math.min(maxY, Math.max(-maxY, panY));
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

export const MIN_VIEW_ZOOM = 1;
export const MAX_VIEW_ZOOM = 5;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_VIEW_ZOOM, Math.max(MIN_VIEW_ZOOM, zoom));
}
