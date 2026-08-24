export type PdfGraphicsKind = "vector" | "raster" | "hybrid" | "image" | "unknown";

export type PdfGraphicsInfo = {
  kind: PdfGraphicsKind;
  summary: string;
  vectorOps: number;
  imageOps: number;
  textOps: number;
};

const IMAGE_OP_NAMES = [
  "paintImageXObject",
  "paintInlineImageXObject",
  "paintImageMaskXObject",
  "paintImageXObjectRepeat",
  "paintImageMaskXObjectRepeat",
  "paintSolidColorImageMask",
  "paintJpegXObject",
];

const VECTOR_OP_NAMES = [
  "constructPath",
  "stroke",
  "closeStroke",
  "fill",
  "eoFill",
  "fillStroke",
  "eoFillStroke",
  "closeFillStroke",
  "closeEOFillStroke",
  "rectangle",
];

const TEXT_OP_NAMES = [
  "showText",
  "showSpacedText",
  "nextLineShowText",
  "nextLineSetSpacingShowText",
];

function opIds(ops: Record<string, number>, names: string[]): Set<number> {
  const ids = new Set<number>();
  for (const name of names) {
    const value = ops[name];
    if (typeof value === "number") ids.add(value);
  }
  return ids;
}

export function countPdfOperators(
  fnArray: number[],
  ops: Record<string, number>,
): Pick<PdfGraphicsInfo, "vectorOps" | "imageOps" | "textOps"> {
  const imageIds = opIds(ops, IMAGE_OP_NAMES);
  const vectorIds = opIds(ops, VECTOR_OP_NAMES);
  const textIds = opIds(ops, TEXT_OP_NAMES);
  let vectorOps = 0;
  let imageOps = 0;
  let textOps = 0;
  for (const fn of fnArray) {
    if (imageIds.has(fn)) imageOps += 1;
    else if (vectorIds.has(fn)) vectorOps += 1;
    else if (textIds.has(fn)) textOps += 1;
  }
  return { vectorOps, imageOps, textOps };
}

export function classifyPdfGraphics(counts: {
  vectorOps: number;
  imageOps: number;
  textOps: number;
}): PdfGraphicsInfo {
  const { vectorOps, imageOps, textOps } = counts;
  const base = { vectorOps, imageOps, textOps };

  if (vectorOps === 0 && imageOps === 0 && textOps === 0) {
    return {
      ...base,
      kind: "unknown",
      summary: "Could not inspect PDF operators. Re-upload if this looks wrong.",
    };
  }

  if (imageOps > 0 && vectorOps < 20) {
    return {
      ...base,
      kind: "raster",
      summary: "Raster PDF — mostly a scanned or exported image, with few vector paths.",
    };
  }
  if (imageOps > 0 && vectorOps >= 20) {
    return {
      ...base,
      kind: "hybrid",
      summary: "Hybrid PDF — vector linework plus embedded images.",
    };
  }
  if (vectorOps >= 8 || textOps >= 5) {
    return {
      ...base,
      kind: "vector",
      summary: "Vector PDF — CAD/paths and/or selectable text.",
    };
  }
  if (imageOps > 0) {
    return {
      ...base,
      kind: "raster",
      summary: "Raster PDF — image-based page.",
    };
  }
  return {
    ...base,
    kind: "vector",
    summary: "Vector PDF — no full-page image detected.",
  };
}

export function rasterImageGraphicsInfo(): PdfGraphicsInfo {
  return {
    kind: "image",
    summary: "Raster image file (PNG/JPEG/WEBP), not a PDF.",
    vectorOps: 0,
    imageOps: 1,
    textOps: 0,
  };
}

export function pdfGraphicsLabel(kind: PdfGraphicsKind | undefined): string {
  switch (kind) {
    case "vector":
      return "Vector PDF";
    case "raster":
      return "Raster PDF";
    case "hybrid":
      return "Hybrid PDF";
    case "image":
      return "Raster image";
    case "unknown":
      return "Unknown";
    default:
      return "Unknown";
  }
}
