/**
 * Map pointer position onto a displayed <img> that may be scaled down
 * (max-width/max-height) but must preserve aspect ratio — no object-fit letterboxing.
 */
export type DisplayedImageRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function clientToImagePixels(
  clientX: number,
  clientY: number,
  display: DisplayedImageRect,
  imageWidthPx: number,
  imageHeightPx: number,
): { x: number; y: number } | null {
  if (display.width <= 0 || display.height <= 0) return null;
  if (imageWidthPx <= 0 || imageHeightPx <= 0) return null;

  const x = ((clientX - display.left) / display.width) * imageWidthPx;
  const y = ((clientY - display.top) / display.height) * imageHeightPx;
  if (x < 0 || y < 0 || x > imageWidthPx || y > imageHeightPx) return null;
  return { x, y };
}

/** Loupe image placement: center of loupe = cursor point on the plan. */
export function loupeImageStyle(
  imgX: number,
  imgY: number,
  imageWidthPx: number,
  imageHeightPx: number,
  displayW: number,
  displayH: number,
  loupeSize: number,
  magnify: number,
): { width: number; height: number; left: number; top: number } {
  const w = displayW * magnify;
  const h = displayH * magnify;
  return {
    width: w,
    height: h,
    left: loupeSize / 2 - (imgX / imageWidthPx) * w,
    top: loupeSize / 2 - (imgY / imageHeightPx) * h,
  };
}
