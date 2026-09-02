export type MetricPoint = { epoch: number; value: number };

export function metricNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

export function pickMetric(
  metrics: Record<string, unknown> | null | undefined,
  needles: string[],
): { key: string; value: number } | null {
  if (!metrics) return null;
  const entries = Object.entries(metrics);
  for (const needle of needles) {
    const hit = entries.find(([key]) => key.toLowerCase().includes(needle.toLowerCase()));
    if (!hit) continue;
    const num = metricNumber(hit[1]);
    if (num == null) continue;
    return { key: hit[0], value: num };
  }
  return null;
}

export function seriesFromHistory(
  history: Record<string, unknown>[],
  needles: string[],
): MetricPoint[] {
  const points: MetricPoint[] = [];
  history.forEach((row, index) => {
    const hit = pickMetric(row, needles);
    if (!hit) return;
    const epoch = metricNumber(row.epoch) ?? index + 1;
    points.push({ epoch, value: hit.value });
  });
  return points;
}

export function historyEpochs(history: Record<string, unknown>[], previewEpochs: number[]): number[] {
  const set = new Set<number>();
  for (const row of history) {
    const epoch = metricNumber(row.epoch);
    if (epoch != null) set.add(epoch);
  }
  for (const epoch of previewEpochs) set.add(epoch);
  return [...set].sort((a, b) => a - b);
}

export function trainingHints(latest: Record<string, unknown> | null | undefined): string[] {
  const hints: string[] = [];
  const precision = pickMetric(latest, ["precision"])?.value;
  const recall = pickMetric(latest, ["recall"])?.value;
  const map5095 = pickMetric(latest, ["map50-95"])?.value;
  const map50Only = pickMetric(latest, ["metrics/mAP50(B)", "metrics/mAP50"])?.value
    ?? (map5095 == null ? pickMetric(latest, ["map50"])?.value : null);

  if (precision != null && recall != null && precision < 0.15 && recall > 0.8) {
    hints.push("High recall, low precision — many false positives. Check conf or class imbalance.");
  }
  if (map50Only != null && map5095 != null && map50Only - map5095 > 0.4) {
    hints.push("mAP50 is high but mAP50-95 is low — detections fire but boxes/masks are poorly aligned.");
  }
  if ((map50Only ?? map5095) != null && (map50Only ?? map5095)! < 0.05) {
    hints.push("mAP is still near zero — labels or task (detect vs segment) may not match the base.");
  }
  return hints;
}

export function overfitHint(loss: MetricPoint[]): string | null {
  if (loss.length < 4) return null;
  const tail = loss.slice(-4);
  const first = tail[0].value;
  const last = tail[tail.length - 1].value;
  if (first > 0 && last > first * 1.08) {
    return "Loss rose over the last epochs — possible overfitting or an unstable batch.";
  }
  return null;
}
