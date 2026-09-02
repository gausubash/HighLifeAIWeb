/** Map a point from a PDF.js viewport into the viewer page raster. */
export function mapPdfViewportToPage(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  pageWidthPx: number,
  pageHeightPx: number,
): { x: number; y: number } {
  const sx = viewportWidth > 0 ? pageWidthPx / viewportWidth : 1;
  const sy = viewportHeight > 0 ? pageHeightPx / viewportHeight : 1;
  return { x: x * sx, y: y * sy };
}
