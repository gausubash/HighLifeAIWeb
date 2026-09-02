"use client";

import { useEffect, useMemo, useState } from "react";
import { studioJobPlotUrl, studioJobPreviewUrl } from "@/lib/studio/studioClient";
import type { MlTrainingJob } from "@/lib/studio/types";
import {
  historyEpochs,
  overfitHint,
  pickMetric,
  seriesFromHistory,
  trainingHints,
  type MetricPoint,
} from "./trainingMonitorMetrics";

type ViewMode = "pred" | "gt" | "split";
type PanelTab = "overlay" | "plots";

function MetricChart({
  points,
  label,
  selectedEpoch,
  onSelectEpoch,
}: {
  points: MetricPoint[];
  label: string;
  selectedEpoch: number | null;
  onSelectEpoch: (epoch: number) => void;
}) {
  const w = 320;
  const h = 88;
  const pad = { l: 8, r: 8, t: 8, b: 16 };
  if (points.length === 0) {
    return <p className="text-[13px] text-slate-400">{label}: waiting for epochs…</p>;
  }
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const xAt = (index: number) =>
    pad.l + (points.length === 1 ? innerW / 2 : (index / (points.length - 1)) * innerW);
  const yAt = (value: number) => pad.t + innerH - ((value - min) / span) * innerH;
  const polyline = points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)}`).join(" ");
  const selected = selectedEpoch != null ? points.find((p) => p.epoch === selectedEpoch) : null;
  const selectedIndex = selected ? points.indexOf(selected) : -1;
  const latest = points[points.length - 1];

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-slate-600">{label}</span>
        <span className="tabular-nums text-[13px] text-slate-800">{latest.value.toFixed(3)}</span>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="mt-1 h-20 w-full cursor-pointer text-brand-700"
        role="img"
        aria-label={`${label} chart`}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * w;
          let nearest = points[0];
          let best = Infinity;
          points.forEach((p, i) => {
            const d = Math.abs(xAt(i) - x);
            if (d < best) {
              best = d;
              nearest = p;
            }
          });
          onSelectEpoch(nearest.epoch);
        }}
      >
        <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={polyline} />
        {selected && selectedIndex >= 0 ? (
          <>
            <line
              x1={xAt(selectedIndex)}
              x2={xAt(selectedIndex)}
              y1={pad.t}
              y2={h - pad.b}
              stroke="#94a3b8"
              strokeDasharray="3 3"
            />
            <circle cx={xAt(selectedIndex)} cy={yAt(selected.value)} r="3.5" fill="currentColor" />
          </>
        ) : null}
      </svg>
      <p className="text-xs text-slate-400">Click a point to jump the overlay to that epoch.</p>
    </div>
  );
}

function PreviewImage({ src, alt }: { src: string; alt: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src}
      src={src}
      alt={alt}
      className="max-h-80 w-full rounded border border-slate-200 bg-slate-100 object-contain"
      onError={(e) => {
        (e.target as HTMLImageElement).style.opacity = "0.35";
      }}
      onLoad={(e) => {
        (e.target as HTMLImageElement).style.opacity = "1";
      }}
    />
  );
}

interface TrainingMonitorProps {
  job: MlTrainingJob;
}

export function TrainingMonitor({ job }: TrainingMonitorProps) {
  const history = (job.metrics_history ?? []) as Record<string, unknown>[];
  const latest = (history[history.length - 1] as Record<string, unknown> | undefined) ?? job.metrics;
  const previewEpochs = job.preview_epochs ?? [];
  const epochs = useMemo(() => historyEpochs(history, previewEpochs), [history, previewEpochs]);
  const latestEpoch = job.preview_epoch ?? epochs[epochs.length - 1] ?? null;

  const [pinnedEpoch, setPinnedEpoch] = useState<number | null>(null);
  const [view, setView] = useState<ViewMode>("pred");
  const [tab, setTab] = useState<PanelTab>("overlay");

  useEffect(() => {
    setPinnedEpoch(null);
    setView("pred");
    setTab("overlay");
  }, [job.id]);

  const selectedEpoch = pinnedEpoch ?? latestEpoch;
  const hasSnapshots = previewEpochs.length > 0;
  const cacheKey = `${job.preview_updated_at ?? ""}-${previewEpochs.join(",")}`;
  const predUrl = studioJobPreviewUrl(job.id, cacheKey, {
    epoch: hasSnapshots ? selectedEpoch : null,
  });
  const gtUrl = studioJobPreviewUrl(job.id, cacheKey, { kind: "gt" });
  const running = job.status === "running" || job.status === "queued";

  const mapSeries = useMemo(
    () => seriesFromHistory(history, ["map50-95", "map50", "metrics/mAP50"]),
    [history],
  );
  const lossSeries = useMemo(
    () => seriesFromHistory(history, ["seg_loss", "box_loss", "train/box_loss", "loss"]),
    [history],
  );

  const headline = [
    pickMetric(latest ?? undefined, ["metrics/mAP50(B)", "metrics/mAP50", "map50"]),
    pickMetric(latest ?? undefined, ["metrics/mAP50-95", "map50-95"]),
    pickMetric(latest ?? undefined, ["metrics/precision", "precision"]),
    pickMetric(latest ?? undefined, ["metrics/recall", "recall"]),
    pickMetric(latest ?? undefined, ["train/seg_loss", "seg_loss", "box_loss"]),
  ].filter(Boolean) as { key: string; value: number }[];

  const hints = useMemo(() => {
    const next = trainingHints(latest ?? undefined);
    const overfit = overfitHint(lossSeries);
    return overfit ? [...next, overfit] : next;
  }, [latest, lossSeries]);

  const plots = job.plots ?? [];
  const minEpoch = epochs[0] ?? 1;
  const maxEpoch = epochs[epochs.length - 1] ?? 1;

  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Live training monitor</h2>
          <p className="text-xs text-slate-500">
            Overlay, ground truth, and epoch curves.{" "}
            {running ? "Refreshing while the job runs…" : "Latest completed run."}
          </p>
        </div>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-600">
          {job.status}
          {selectedEpoch != null ? ` · ep ${selectedEpoch}` : ""}
        </span>
      </div>

      <div className="btn-segment-group">
        <button
          type="button"
          className={tab === "overlay" ? "btn-segment bg-slate-100 font-medium" : "btn-segment"}
          onClick={() => setTab("overlay")}
        >
          Overlay
        </button>
        <button
          type="button"
          className={tab === "plots" ? "btn-segment bg-slate-100 font-medium" : "btn-segment"}
          onClick={() => setTab("plots")}
          disabled={plots.length === 0}
        >
          Plots{plots.length ? ` (${plots.length})` : ""}
        </button>
      </div>

      {tab === "plots" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {plots.map((plot) => (
            <figure key={plot.id} className="min-w-0">
              <p className="mb-1 text-[13px] font-medium uppercase tracking-wide text-slate-500">
                {plot.label}
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={studioJobPlotUrl(job.id, plot.id, cacheKey)}
                alt={plot.label}
                className="max-h-72 w-full rounded border border-slate-200 bg-white object-contain"
              />
            </figure>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <div className="btn-segment-group">
              {(
                [
                  ["pred", "Prediction"],
                  ...(job.has_gt_preview ? ([["gt", "Ground truth"]] as const) : []),
                  ...(job.has_gt_preview ? ([["split", "Split"]] as const) : []),
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={view === id ? "btn-segment bg-slate-100 font-medium" : "btn-segment"}
                  onClick={() => setView(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {view === "split" && job.has_gt_preview ? (
              <div className="grid grid-cols-2 gap-2">
                <PreviewImage src={gtUrl} alt="Ground-truth labels" />
                <PreviewImage src={predUrl} alt="Model prediction" />
              </div>
            ) : (
              <PreviewImage
                src={view === "gt" && job.has_gt_preview ? gtUrl : predUrl}
                alt={view === "gt" ? "Ground-truth labels" : "Training prediction overlay"}
              />
            )}
            {epochs.length > 1 ? (
              <label className="block text-[13px] font-medium text-slate-600">
                Epoch {selectedEpoch ?? "—"}
                {!hasSnapshots ? " · overlay is latest (history starts on the next run)" : ""}
                <input
                  type="range"
                  className="mt-1 w-full"
                  min={minEpoch}
                  max={maxEpoch}
                  step={1}
                  value={selectedEpoch ?? maxEpoch}
                  onChange={(e) => setPinnedEpoch(Number(e.target.value))}
                />
              </label>
            ) : (
              <p className="text-xs text-slate-400">
                Overlay updates after each epoch. Scrub history appears once more than one snapshot is saved.
              </p>
            )}
          </div>

          <div className="space-y-3">
            <div className="h-1.5 overflow-hidden rounded bg-slate-100">
              <div
                className="h-full bg-brand-600 transition-all"
                style={{ width: `${Math.min(100, job.progress)}%` }}
              />
            </div>
            <p className="text-[13px] text-slate-600">{job.log_tail || "—"}</p>

            {hints.length > 0 ? (
              <ul className="space-y-1 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[13px] text-amber-900">
                {hints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            ) : null}

            {headline.length > 0 ? (
              <dl className="grid grid-cols-2 gap-2 text-xs">
                {headline.map((item) => (
                  <div key={item.key} className="rounded border border-slate-200 px-2 py-1.5">
                    <dt className="truncate text-xs text-slate-500" title={item.key}>
                      {item.key.replace(/^metrics\//, "").replace(/^train\//, "")}
                    </dt>
                    <dd className="tabular-nums font-medium text-slate-900">{item.value.toFixed(4)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-[13px] text-slate-500">Metrics appear after the first validation epoch.</p>
            )}

            <MetricChart
              points={mapSeries}
              label="mAP trend"
              selectedEpoch={selectedEpoch}
              onSelectEpoch={setPinnedEpoch}
            />
            <MetricChart
              points={lossSeries}
              label="Loss trend"
              selectedEpoch={selectedEpoch}
              onSelectEpoch={setPinnedEpoch}
            />
          </div>
        </div>
      )}
    </section>
  );
}
