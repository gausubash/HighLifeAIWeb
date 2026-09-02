import type { PaddleOcrOptions } from "@/lib/api/ocrClient";

export type OcrCropKind = "title_block" | "drawing" | "page";

/** Sent from the options UI when Det / Side should follow the crop. */
export const OCR_RESOLUTION_AUTO = 0;

const TITLE_DET_STEPS = [736, 960, 1280] as const;
const DRAWING_DET_STEPS = [960, 1280, 1536, 2048, 4096] as const;
const VL_SIDE_STEPS = [1024, 1536, 2048, 3072, 4096] as const;

function snapUp(value: number, steps: readonly number[]): number {
  for (const step of steps) {
    if (value <= step) return step;
  }
  return steps[steps.length - 1]!;
}

export function ocrResolutionForCrop(opts: {
  kind: OcrCropKind;
  widthPx: number;
  heightPx: number;
}): { detLimitSideLen: number; vlMaxSide: number } {
  const long = Math.max(1, Math.round(opts.widthPx), Math.round(opts.heightPx));
  if (opts.kind === "title_block") {
    const det = snapUp(long, TITLE_DET_STEPS);
    return { detLimitSideLen: det, vlMaxSide: Math.min(2048, Math.max(1024, det)) };
  }
  return {
    detLimitSideLen: snapUp(long, DRAWING_DET_STEPS),
    vlMaxSide: snapUp(long, VL_SIDE_STEPS),
  };
}

export function applyOcrResolution(
  options: PaddleOcrOptions,
  kind: OcrCropKind,
  widthPx: number,
  heightPx: number,
): PaddleOcrOptions {
  const auto = ocrResolutionForCrop({ kind, widthPx, heightPx });
  const detLimitSideLen =
    options.detLimitSideLen && options.detLimitSideLen > 0
      ? options.detLimitSideLen
      : auto.detLimitSideLen;
  const vlMaxSide =
    options.vlMaxSide && options.vlMaxSide > 0 ? options.vlMaxSide : auto.vlMaxSide;
  // The crop is already the same way up as the sheet. Paddle's whole-image
  // orient/unwarp returns boxes on a warped copy, so labels land on the wrong room.
  return {
    ...options,
    detLimitSideLen,
    vlMaxSide,
    useDocOrientationClassify: false,
    useDocUnwarping: false,
  };
}
