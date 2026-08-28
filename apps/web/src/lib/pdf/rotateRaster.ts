"use client";

import {
  rotatedSize,
  type PageRotationDeg,
} from "./pageRotation";

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not encode the rotated page image."));
    }, "image/png");
  });
}

/**
 * Rotate a page raster (PDF PNG or uploaded image) clockwise.
 * 0 returns the original blob and its natural size.
 */
export async function rotateImageBlob(
  blob: Blob,
  deg: PageRotationDeg,
): Promise<{ blob: Blob; widthPx: number; heightPx: number }> {
  const bitmap = await createImageBitmap(blob);
  try {
    if (deg === 0) {
      return { blob, widthPx: bitmap.width, heightPx: bitmap.height };
    }
    const canvas = document.createElement("canvas");
    const size = rotatedSize(bitmap.width, bitmap.height, deg);
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Unable to create 2D canvas context.");
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    const out = await canvasToPngBlob(canvas);
    return { blob: out, widthPx: canvas.width, heightPx: canvas.height };
  } finally {
    bitmap.close();
  }
}
