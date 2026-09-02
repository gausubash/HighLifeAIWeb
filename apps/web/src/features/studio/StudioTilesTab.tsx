"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { WorkspaceShell } from "@/components/shell/WorkspaceShell";
import { HoverHint } from "@/components/ui/HoverHint";
import {
  createDatasetTiles,
  getDataset,
  listDatasets,
  studioPageImageUrl,
} from "@/lib/studio/studioClient";
import type { MlDataset, StudioPage } from "@/lib/studio/types";

interface StudioTilesTabProps {
  activityRail?: ReactNode;
  initialDatasetId?: string;
  onAnnotate?: (datasetId: string) => void;
  onOpenTrain?: (datasetId: string) => void;
}

const TILE_SIZE_OPTIONS = [512, 640, 768, 1024] as const;

function isTilePage(page: StudioPage): boolean {
  return (page.kind || "") === "tile" || /_tile\d+/i.test(page.source_name || "");
}

function TilePreview({
  datasetId,
  page,
  selected,
  onSelect,
}: {
  datasetId: string;
  page: StudioPage;
  selected: boolean;
  onSelect: () => void;
}) {
  const src = `${studioPageImageUrl(datasetId, page.id)}?v=${page.width_px}x${page.height_px}`;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        selected
          ? "overflow-hidden rounded border border-brand-500 bg-brand-50 text-left ring-1 ring-brand-400/50"
          : "overflow-hidden rounded border border-slate-200 bg-white text-left hover:border-slate-300"
      }
    >
      <div className="aspect-square bg-slate-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="h-full w-full object-contain" loading="lazy" />
      </div>
      <div className="space-y-0.5 px-1.5 py-1">
        <p className="truncate text-xs font-medium text-slate-800" title={page.source_name}>
          {page.source_name}
        </p>
        <p className="text-xs text-slate-500">
          {page.width_px}×{page.height_px}
          {(page.split || "train") === "test" ? " · test" : " · train"}
          {page.labeled ? ` · ${page.shape_count} labels` : " · unlabeled"}
        </p>
      </div>
    </button>
  );
}

export function StudioTilesTab({
  activityRail,
  initialDatasetId,
  onAnnotate,
  onOpenTrain,
}: StudioTilesTabProps) {
  const [datasets, setDatasets] = useState<MlDataset[]>([]);
  const [datasetId, setDatasetId] = useState(initialDatasetId || "");
  const [dataset, setDataset] = useState<MlDataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tileSize, setTileSize] = useState(640);
  const [overlap, setOverlap] = useState(0.2);
  const [onlyLabeled, setOnlyLabeled] = useState(true);
  const [skipUnlabeled, setSkipUnlabeled] = useState(true);
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "labeled" | "unlabeled">("all");

  const tiles = useMemo(() => {
    const pages = (dataset?.pages ?? []).filter(isTilePage);
    if (filter === "labeled") return pages.filter((p) => p.labeled);
    if (filter === "unlabeled") return pages.filter((p) => !p.labeled);
    return pages;
  }, [dataset, filter]);

  const selected = tiles.find((p) => p.id === selectedId) ?? tiles[0] ?? null;

  const refresh = useCallback(
    async (selectId?: string) => {
      const next = await listDatasets();
      setDatasets(next);
      const id = selectId ?? datasetId ?? next[0]?.id ?? "";
      setDatasetId(id);
      if (id) {
        setDataset(await getDataset(id));
      } else {
        setDataset(null);
      }
    },
    [datasetId],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setError(null);
        await refresh(initialDatasetId || undefined);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load datasets.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!datasetId) {
      setDataset(null);
      return;
    }
    let cancelled = false;
    void getDataset(datasetId)
      .then((next) => {
        if (!cancelled) setDataset(next);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not open dataset.");
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  useEffect(() => {
    if (selected && !tiles.some((t) => t.id === selected.id)) {
      setSelectedId(tiles[0]?.id ?? null);
    } else if (!selectedId && tiles[0]) {
      setSelectedId(tiles[0].id);
    }
  }, [tiles, selected, selectedId]);

  const onGenerate = async () => {
    if (!datasetId) return;
    setBusy(true);
    setError(null);
    setMessage(`Creating ${tileSize}px tiles…`);
    try {
      const next = await createDatasetTiles(datasetId, {
        tileSize,
        overlap,
        onlyLabeled,
        skipUnlabeled,
        replaceExisting,
      });
      setDataset(next);
      await refresh(next.id);
      const created = next.tiles_created ?? 0;
      const labeled = next.tiles_labeled ?? 0;
      const skipped = next.tiles_skipped_small ?? 0;
      const skippedDrawing = next.tiles_skipped_no_drawing ?? 0;
      const fullPage = next.tiles_full_page_fallback ?? 0;
      const skippedUnlabeled = next.tiles_skipped_unlabeled ?? 0;
      const parts: string[] = [];
      if (created > 0) {
        parts.push(`Created ${created} tile(s) (${labeled} with labels).`);
      }
      if (fullPage > 0) {
        parts.push(
          `${fullPage} page(s) tiled from the full sheet (no Drawing area box — draw Main drawing in Annotate or layout YOLO will crop automatically when weights are available).`,
        );
      }
      if (skippedUnlabeled > 0) {
        parts.push(`${skippedUnlabeled} unlabeled tile(s) skipped.`);
      }
      if (skipped > 0) {
        parts.push(`${skipped} page(s) drawing area too small to tile.`);
      }
      if (skippedDrawing > 0) {
        parts.push(
          `${skippedDrawing} page(s) skipped — no drawing area (draw a Drawing area box or enable layout detect).`,
        );
      }
      setMessage(
        parts.length > 0
          ? parts.join(" ")
          : skippedDrawing > 0
            ? `No tiles created — ${skippedDrawing} page(s) have no drawing area. Annotate a Drawing area rectangle first.`
            : skipped > 0
              ? `No tiles created — ${skipped} page(s) drawing area was smaller than the tile gate.`
              : "No tiles created. Convert PDFs to images and annotate first.",
      );
      const tilePages = (next.pages ?? []).filter(isTilePage);
      if (tilePages[0]) setSelectedId(tilePages[0].id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create tiles.");
      setMessage(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <WorkspaceShell
      hideTopBar
      allowNewProjectShortcut={false}
      activityRail={activityRail}
    >
      <div className="flex h-full min-h-0 flex-col bg-white">
        <div className="shrink-0 border-b border-slate-200 px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-xs font-medium text-slate-600">
              Dataset
              <select
                className="mt-1 block min-w-[12rem] rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={datasetId}
                disabled={busy || datasets.length === 0}
                onChange={(e) => {
                  setDatasetId(e.target.value);
                  setMessage(null);
                  setSelectedId(null);
                }}
              >
                {datasets.length === 0 ? (
                  <option value="">No datasets</option>
                ) : (
                  datasets.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))
                )}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600">
              Tile size
              <select
                className="mt-1 block rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={tileSize}
                disabled={busy}
                onChange={(e) => setTileSize(Number(e.target.value))}
              >
                {TILE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}px
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600">
              Overlap
              <select
                className="mt-1 block rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                value={overlap}
                disabled={busy}
                onChange={(e) => setOverlap(Number(e.target.value))}
              >
                <option value={0}>0%</option>
                <option value={0.1}>10%</option>
                <option value={0.2}>20%</option>
                <option value={0.3}>30%</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 pb-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={onlyLabeled}
                disabled={busy}
                onChange={(e) => setOnlyLabeled(e.target.checked)}
              />
              Labeled pages only
            </label>
            <label className="flex items-center gap-1.5 pb-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={skipUnlabeled}
                disabled={busy}
                onChange={(e) => setSkipUnlabeled(e.target.checked)}
              />
              Skip unlabeled tiles
            </label>
            <label className="flex items-center gap-1.5 pb-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={replaceExisting}
                disabled={busy}
                onChange={(e) => setReplaceExisting(e.target.checked)}
              />
              Replace existing tiles
            </label>
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={busy || !datasetId}
              onClick={() => void onGenerate()}
            >
              {busy ? "Generating…" : "Generate tiles"}
            </button>
            {datasetId ? (
              <>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  disabled={busy}
                  onClick={() => onAnnotate?.(datasetId)}
                >
                  Annotate
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  disabled={busy}
                  onClick={() => onOpenTrain?.(datasetId)}
                >
                  Train
                </button>
              </>
            ) : null}
          </div>
          <div className="mt-2 flex items-center gap-1">
            <span className="text-xs font-medium text-slate-600">Tiles</span>
            <HoverHint
              align="start"
              label="About tiles"
              text="Tiles crop to the Main drawing / Drawing area rectangle when you draw one in Annotate. Otherwise layout YOLO (when weights are installed) finds the floor plan, or the full sheet is tiled. Enable Skip unlabeled tiles to drop windows with no clipped labels — useful for training."
            />
          </div>
          {message ? <p className="mt-2 text-xs text-slate-700">{message}</p> : null}
          {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-600">Show</span>
              {(
                [
                  ["all", "All"],
                  ["labeled", "Labeled"],
                  ["unlabeled", "Unlabeled"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={
                    filter === id
                      ? "rounded bg-brand-700 px-2 py-0.5 text-xs font-medium text-white"
                      : "rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
                  }
                  onClick={() => setFilter(id)}
                >
                  {label}
                </button>
              ))}
              <span className="text-xs text-slate-500">{tiles.length} shown</span>
            </div>

            {tiles.length === 0 ? (
              <div className="rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
                <p className="text-sm font-medium text-slate-800">No training tiles yet</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  Annotate full pages, then generate tiles here (match Train → image size).
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {tiles.map((page) => (
                  <TilePreview
                    key={page.id}
                    datasetId={datasetId}
                    page={page}
                    selected={selected?.id === page.id}
                    onSelect={() => setSelectedId(page.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {selected && datasetId ? (
            <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-slate-50 p-3 md:block">
              <p className="text-xs font-semibold text-slate-800">Selected tile</p>
              <p className="mt-0.5 break-all text-xs text-slate-500">{selected.source_name}</p>
              <div className="mt-2 overflow-hidden rounded border border-slate-200 bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${studioPageImageUrl(datasetId, selected.id)}?v=${selected.width_px}x${selected.height_px}`}
                  alt=""
                  className="w-full object-contain"
                />
              </div>
              <dl className="mt-3 space-y-1 text-[13px] text-slate-600">
                <div className="flex justify-between gap-2">
                  <dt>Size</dt>
                  <dd className="font-medium text-slate-800">
                    {selected.width_px}×{selected.height_px}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Split</dt>
                  <dd className="font-medium text-slate-800">{selected.split || "train"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Labels</dt>
                  <dd className="font-medium text-slate-800">
                    {selected.labeled ? selected.shape_count : 0}
                  </dd>
                </div>
                {selected.source_path ? (
                  <div className="pt-1">
                    <dt className="text-slate-500">Group</dt>
                    <dd className="break-all font-medium text-slate-800">{selected.source_path}</dd>
                  </div>
                ) : null}
              </dl>
            </aside>
          ) : null}
        </div>
      </div>
    </WorkspaceShell>
  );
}
