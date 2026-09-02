/** Hold-out metrics for the journal eval harness. Gold vs predicted, no invented geometry. */

export type EvalBox = { x: number; y: number; width: number; height: number; label?: string };

export function boxIoU(a: EvalBox, b: EvalBox): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

/** Single-class panoptic quality from matched instances at IoU ≥ 0.5. */
export function panopticQuality(
  gold: EvalBox[],
  pred: EvalBox[],
  iouThresh = 0.5,
): { pq: number; sq: number; rq: number; tp: number; fp: number; fn: number } {
  const used = new Set<number>();
  let tp = 0;
  let iouSum = 0;
  for (const g of gold) {
    let best = -1;
    let bestIou = 0;
    pred.forEach((p, i) => {
      if (used.has(i)) return;
      const iou = boxIoU(g, p);
      if (iou > bestIou) {
        bestIou = iou;
        best = i;
      }
    });
    if (best >= 0 && bestIou >= iouThresh) {
      used.add(best);
      tp += 1;
      iouSum += bestIou;
    }
  }
  const fp = pred.length - tp;
  const fn = gold.length - tp;
  const sq = tp ? iouSum / tp : 0;
  const rq = tp + 0.5 * fp + 0.5 * fn > 0 ? tp / (tp + 0.5 * fp + 0.5 * fn) : 0;
  return { pq: sq * rq, sq, rq, tp, fp, fn };
}

export function meanAveragePrecision(gold: EvalBox[], pred: EvalBox[], iouThresh = 0.5): number {
  const { tp, fp } = panopticQuality(gold, pred, iouThresh);
  const denom = tp + fp;
  return denom > 0 ? tp / denom : gold.length === 0 ? 1 : 0;
}

/** Relative error; null predicted with gold present is 1 (miss). */
export function relativeError(gold: number, pred: number | null | undefined): number {
  if (pred == null || !Number.isFinite(pred)) return 1;
  if (gold === 0) return Math.abs(pred) > 1e-9 ? 1 : 0;
  return Math.abs(pred - gold) / Math.abs(gold);
}

export function bearingErrorDeg(gold: number, pred: number | null | undefined): number | null {
  if (pred == null || !Number.isFinite(pred)) return null;
  const d = Math.abs(((pred - gold + 540) % 360) - 180);
  return Math.min(d, 360 - d);
}

export type FprEvalRow = {
  sheetId: string;
  unitPq: number;
  roomPq: number;
  openingAp: number;
  areaRelError: number | null;
  openingRelError: number | null;
  bearingAbsErrorDeg: number | null;
  ablation?: string;
};

export function formatEvalCsv(rows: FprEvalRow[]): string {
  const header = [
    "sheetId",
    "unitPq",
    "roomPq",
    "openingAp",
    "areaRelError",
    "openingRelError",
    "bearingAbsErrorDeg",
    "ablation",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.sheetId,
        r.unitPq.toFixed(4),
        r.roomPq.toFixed(4),
        r.openingAp.toFixed(4),
        r.areaRelError ?? "",
        r.openingRelError ?? "",
        r.bearingAbsErrorDeg ?? "",
        r.ablation ?? "",
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}
