"use client";

import { useMemo } from "react";
import { studioJobPreviewUrl } from "@/lib/studio/studioClient";
import type { MlTrainingJob } from "@/lib/studio/types";

function metricNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

function pickMetric(
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

function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length === 0) {
    return <p className="text-[11px] text-slate-400">{label}: waiting for epochs…</p>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const w = 160;
  const h = 36;
  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? w / 2 : (index / (values.length - 1)) * w;
      const y = h - ((value - min) / span) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-slate-600">{label}</span>
        <span className="tabular-nums text-[11px] text-slate-800">{values[values.length - 1].toFixed(3)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 h-9 w-full text-brand-700" aria-hidden>
        <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points} />
      </svg>
    </div>
  );
}

interface TrainingMonitorProps {
  job: MlTrainingJob;
}

export function TrainingMonitor({ job }: TrainingMonitorProps) {
  const history = job.metrics_history ?? [];
  const latest = (history[history.length - 1] as Record<string, unknown> | undefined) ?? job.metrics;

  const mapSeries = useMemo(() => {
    return history
      .map((row) => pickMetric(row as Record<string, unknown>, ["map50-95", "map50", "metrics/mAP50"])?.value)
      .filter((value): value is number => value != null);
  }, [history]);

  const lossSeries = useMemo(() => {
    return history
      .map((row) => pickMetric(row as Record<string, unknown>, ["seg_loss", "box_loss", "train/box_loss", "loss"])?.value)
      .filter((value): value is number => value != null);
  }, [history]);

  const headline = [
    pickMetric(latest ?? undefined, ["metrics/mAP50(B)", "metrics/mAP50", "map50"]),
    pickMetric(latest ?? undefined, ["metrics/mAP50-95", "map50-95"]),
    pickMetric(latest ?? undefined, ["metrics/precision", "precision"]),
    pickMetric(latest ?? undefined, ["metrics/recall", "recall"]),
    pickMetric(latest ?? undefined, ["train/seg_loss", "seg_loss", "box_loss"]),
  ].filter(Boolean) as { key: string; value: number }[];

  const previewCacheKey =
    job.preview_updated_at ??
    (job.preview_epoch != null ? `ep${job.preview_epoch}` : null) ??
    `${job.progress}-${history.length}`;
  const previewUrl = studioJobPreviewUrl(job.id, previewCacheKey);
  const running = job.status === "running" || job.status === "queued";

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Live training monitor</h2>
          <p className="text-xs text-slate-500">
            Segmentation overlay on a sample page + metrics each epoch.{" "}
            {running ? "Refreshing while the job runs…" : "Latest completed run."}
          </p>
        </div>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
          {job.status}
          {job.preview_epoch != null ? ` · ep ${job.preview_epoch}` : ""}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Region segmentation preview
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={previewUrl}
            src={previewUrl}
            alt="Training segmentation preview"
            className="max-h-80 w-full rounded border border-slate-200 bg-slate-100 object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.opacity = "0.35";
            }}
            onLoad={(e) => {
              (e.target as HTMLImageElement).style.opacity = "1";
            }}
          />
          <p className="mt-1 text-[10px] text-slate-400">
            Overlay updates after each epoch (may take a moment on CPU).
          </p>
        </div>

        <div className="space-y-3">
          <div className="h-1.5 overflow-hidden rounded bg-slate-100">
            <div className="h-full bg-brand-600 transition-all" style={{ width: `${Math.min(100, job.progress)}%` }} />
          </div>
          <p className="text-[11px] text-slate-600">{job.log_tail || "—"}</p>

          {headline.length > 0 ? (
            <dl className="grid grid-cols-2 gap-2 text-xs">
              {headline.map((item) => (
                <div key={item.key} className="rounded border border-slate-200 px-2 py-1.5">
                  <dt className="truncate text-[10px] text-slate-500" title={item.key}>
                    {item.key.replace(/^metrics\//, "").replace(/^train\//, "")}
                  </dt>
                  <dd className="tabular-nums font-medium text-slate-900">{item.value.toFixed(4)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-[11px] text-slate-500">Metrics appear after the first validation epoch.</p>
          )}

          <Sparkline values={mapSeries} label="mAP trend" />
          <Sparkline values={lossSeries} label="Loss trend" />
        </div>
      </div>
    </section>
  );
}
