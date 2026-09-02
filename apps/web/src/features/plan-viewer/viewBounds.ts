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
/** 1500% of fit. */
export const MAX_VIEW_ZOOM = 15;

export const WHEEL_ZOOM_STEP = 1;
export const WHEEL_ZOOM_STEP_FAST = 3;
export const BUTTON_ZOOM_STEP = 1;
export const BUTTON_ZOOM_STEP_FAST = 3;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_VIEW_ZOOM, Math.max(MIN_VIEW_ZOOM, zoom));
}

export function zoomDeltaFromWheel(altKey: boolean, deltaY: number): number {
  const step = altKey ? WHEEL_ZOOM_STEP_FAST : WHEEL_ZOOM_STEP;
  return deltaY > 0 ? -step : step;
}

export function zoomDeltaFromButton(altKey: boolean, direction: 1 | -1): number {
  return direction * (altKey ? BUTTON_ZOOM_STEP_FAST : BUTTON_ZOOM_STEP);
}

/** New pan so `origin` (viewport-relative) stays under the cursor after zoom. */
export function panForZoomAtPoint(
  panX: number,
  panY: number,
  fromZoom: number,
  toZoom: number,
  originX: number,
  originY: number,
  viewportW: number,
  viewportH: number,
): { x: number; y: number } {
  if (fromZoom <= 0 || fromZoom === toZoom) return { x: panX, y: panY };
  const scale = toZoom / fromZoom;
  return {
    x: panX * scale + (originX - viewportW / 2) * (1 - scale),
    y: panY * scale + (originY - viewportH / 2) * (1 - scale),
  };
}
