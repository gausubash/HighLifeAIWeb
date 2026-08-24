export async function rasterBlobForDetect(sourceUrl: string, maxEdge = 2000): Promise<Blob> {
  const res = await fetch(sourceUrl);
  if (!res.ok) {
    throw new Error("Could not read page image.");
  }
  const blob = await res.blob();
  if (typeof createImageBitmap !== "function") {
    return blob;
  }
  const bitmap = await createImageBitmap(blob);
  const longest = Math.max(bitmap.width, bitmap.height);
  if (longest <= maxEdge) {
    bitmap.close();
    return blob;
  }
  const scale = maxEdge / longest;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return blob;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const encoded = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((next) => resolve(next), "image/png");
  });
  if (!encoded) {
    throw new Error("Could not encode page image for detection.");
  }
  return encoded;
}
