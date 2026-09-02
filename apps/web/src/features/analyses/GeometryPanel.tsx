"use client";

import { useMemo } from "react";
import { HeadingHint, HoverHint } from "@/components/ui/HoverHint";
import { classSwatch, wallClassificationSwatch } from "@/features/plan-editor/styles";
import { overlayGeometryPoints } from "@/features/plan-editor/geometry";
import { applyUnitBoundariesFromPage } from "@/lib/hierarchy/applyUnitBoundaries";
import { pageKey, useOverlayStore } from "@/features/plan-editor/useOverlayStore";
import type { OverlayEntity } from "@/features/plan-editor/types";
import {
  useWallClassificationStore,
  type WallClassifyMode,
} from "@/features/plan-editor/useWallClassificationStore";
import {
  extractedRoomsFromPolygons,
  extractWallBoundedRooms,
  type ExtractedGeometryRoom,
} from "@/lib/geometry/wallBoundedRooms";
import { isRoomOverlayEntity, isUnitOutlineEntity, isWallOverlayEntity } from "@/features/plan-editor/labelClasses";
import { labelRoomsFromDetectionAndOcr } from "@/lib/geometry/labelRoomsFromDetectionAndOcr";
import {
  buildRoomGraph,
  egoNeighborhood,
  habitableMissingWindows,
  unitHasCrossVentPath,
  type RoomGraph,
} from "@/lib/geometry/roomGraph";
import { buildUnitGraph } from "@/lib/geometry/buildUnitGraph";
import { classifyWallEntities } from "@/lib/geometry/classifyWallEntities";
import { extractGeometryFromImage } from "@/lib/api/floorPlanClient";
import type { DrawingOcrLine } from "@/lib/hierarchy/inferUnitBoundaries";
import type { ApartmentTypeLine } from "@/lib/hierarchy/apartmentType";
import { useMainDoorDetectionStore, mainDoorWidthOptsFromStore } from "@/features/plan-editor/useMainDoorDetectionStore";
import {
  autoMainDoorSplitSpan,
  classifyMainDoorsByWidth,
  type MainDoorWidthMode,
} from "@/lib/hierarchy/communalMainDoor";
import { doorLikesFromEntities } from "@/lib/hierarchy/doorLikesFromEntities";
import { cn } from "@/lib/utils";
import { useGeometryExtractStore } from "./useGeometryExtractStore";
import { UnitGraphSection } from "./UnitGraphSection";

type Props = {
  analysisId: string;
  pageNumber: number;
  widthPx: number;
  heightPx: number;
  entities: OverlayEntity[];
  pixelsPerMeter: number | null;
  pageImageUrl: string | null;
  drawingOcrLines?: DrawingOcrLine[] | null;
  ocrLinesForTypes?: ApartmentTypeLine[] | null;
};

function formatArea(m2: number | null, px2: number, scaled: boolean): string {
  if (m2 != null && Number.isFinite(m2)) return `${m2 >= 10 ? m2.toFixed(0) : m2.toFixed(1)} m²`;
  if (!scaled && px2 > 0) return `${px2.toFixed(0)} px²`;
  return "—";
}

function formatLen(m: number | null, px: number, scaled: boolean): string {
  if (m != null && Number.isFinite(m)) return m >= 10 ? `${m.toFixed(1)} m` : `${m.toFixed(2)} m`;
  if (!scaled && px > 0) return `${px.toFixed(0)} px`;
  return "—";
}

function unitCount(entities: OverlayEntity[]): number {
  return entities.filter((e) => isUnitOutlineEntity(e)).length;
}

function wallCount(entities: OverlayEntity[]): number {
  return entities.filter((e) => isWallOverlayEntity(e)).length;
}

function doorCount(entities: OverlayEntity[]): number {
  return entities.filter((e) => e.type === "door" && e.status !== "rejected").length;
}

function roomOverlayCount(entities: OverlayEntity[]): number {
  return entities.filter((e) => isRoomOverlayEntity(e)).length;
}

function UnitVentNote({
  graph,
  rooms,
}: {
  graph: NonNullable<ReturnType<typeof buildRoomGraph>>;
  rooms: ExtractedGeometryRoom[];
}) {
  const sample = rooms[0];
  if (!sample) return null;
  const missing = habitableMissingWindows(graph, sample.unitId, sample.unitLabel);
  const cross = unitHasCrossVentPath(graph, sample.unitId, sample.unitLabel);
  if (cross == null && missing.length === 0) return null;
  return (
    <p className="text-xs leading-snug text-slate-500">
      {cross === true
        ? "Cross-vent path: two windowed rooms linked by doors."
        : cross === false
          ? "No door-path between two windowed rooms."
          : null}
      {missing.length
        ? `${cross != null ? " " : ""}No exterior window: ${missing.map((r) => r.label).join(", ")}.`
        : ""}
    </p>
  );
}

function RoomEgoCard({
  ego,
  onSelectNeighbor,
}: {
  ego: NonNullable<ReturnType<typeof egoNeighborhood>>;
  onSelectNeighbor: (id: string) => void;
}) {
  return (
    <div className="space-y-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-1.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
        Graph · {ego.room.label}
      </p>
      <p className="text-xs leading-snug text-slate-600">
        {ego.habitable
          ? ego.hasExteriorWindow
            ? "Habitable room with an exterior window."
            : "Habitable room — no exterior window on the contour."
          : "Not a habitable room for ventilation checks."}
      </p>
      {ego.windows.length ? (
        <p className="text-xs text-slate-600">
          Windows: {ego.windows.map((w) => w.label).join(", ")}
        </p>
      ) : null}
      {ego.doors.length ? (
        <p className="text-xs text-slate-600">
          Doors:{" "}
          {ego.doors.map((d, i) => (
            <span key={d.id}>
              {i > 0 ? ", " : ""}
              {d.neighborId ? (
                <button
                  type="button"
                  className="underline decoration-slate-300 hover:text-slate-900"
                  onClick={() => onSelectNeighbor(d.neighborId!)}
                >
                  {d.neighborLabel ?? d.label}
                </button>
              ) : (
                d.label
              )}
            </span>
          ))}
        </p>
      ) : null}
      {ego.walls.length ? (
        <p className="text-xs text-slate-600">
          Shared wall:{" "}
          {ego.walls.map((w, i) => (
            <span key={w.id}>
              {i > 0 ? ", " : ""}
              <button
                type="button"
                className="underline decoration-slate-300 hover:text-slate-900"
                onClick={() => onSelectNeighbor(w.id)}
              >
                {w.label}
              </button>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

export function GeometryPanel({
  analysisId,
  pageNumber,
  widthPx,
  heightPx,
  entities,
  pixelsPerMeter,
  pageImageUrl,
  drawingOcrLines,
  ocrLinesForTypes,
}: Props) {
  const externalMinMm = useWallClassificationStore((s) => s.externalMinMm);
  const externalMinPx = useWallClassificationStore((s) => s.externalMinPx);
  const wallMode = useWallClassificationStore((s) => s.mode);
  const colorByThickness = useWallClassificationStore((s) => s.colorByThickness);
  const setExternalMinMm = useWallClassificationStore((s) => s.setExternalMinMm);
  const setExternalMinPx = useWallClassificationStore((s) => s.setExternalMinPx);
  const setWallMode = useWallClassificationStore((s) => s.setMode);
  const setColorByThickness = useWallClassificationStore((s) => s.setColorByThickness);

  const mainDoorMode = useMainDoorDetectionStore((s) => s.mode);
  const mainDoorMinSpanPx = useMainDoorDetectionStore((s) => s.minSpanPx);
  const highlightMainDoors = useMainDoorDetectionStore((s) => s.highlightOnDrawing);
  const setMainDoorMode = useMainDoorDetectionStore((s) => s.setMode);
  const setMainDoorMinSpanPx = useMainDoorDetectionStore((s) => s.setMinSpanPx);
  const setHighlightMainDoors = useMainDoorDetectionStore((s) => s.setHighlightOnDrawing);

  const storePageKey = useGeometryExtractStore((s) => s.pageKey);
  const rooms = useGeometryExtractStore((s) => s.rooms);
  const graph = useGeometryExtractStore((s) => s.graph);
  const showOverlays = useGeometryExtractStore((s) => s.showOverlays);
  const selectedId = useGeometryExtractStore((s) => s.selectedId);
  const activeUnitId = useGeometryExtractStore((s) => s.activeUnitId);
  const extracting = useGeometryExtractStore((s) => s.extracting);
  const error = useGeometryExtractStore((s) => s.error);
  const warning = useGeometryExtractStore((s) => s.warning);
  const setShowOverlays = useGeometryExtractStore((s) => s.setShowOverlays);
  const setSelectedId = useGeometryExtractStore((s) => s.setSelectedId);
  const setActiveUnitId = useGeometryExtractStore((s) => s.setActiveUnitId);
  const setExtracting = useGeometryExtractStore((s) => s.setExtracting);
  const setError = useGeometryExtractStore((s) => s.setError);
  const setResult = useGeometryExtractStore((s) => s.setResult);

  const key = pageKey(analysisId, pageNumber);
  const pageRooms = storePageKey === key ? rooms : [];
  const pageGraph = storePageKey === key ? graph : null;
  const units = unitCount(entities);
  const walls = wallCount(entities);
  const doors = doorCount(entities);
  const overlayRooms = roomOverlayCount(entities);
  const scaled = pixelsPerMeter != null && pixelsPerMeter > 0;

  const doorLikes = useMemo(() => doorLikesFromEntities(entities), [entities]);
  const mainDoorWidthOpts = useMemo(
    () => ({ mode: mainDoorMode, minSpanPx: mainDoorMinSpanPx }),
    [mainDoorMode, mainDoorMinSpanPx],
  );
  const mainDoorIds = useMemo(
    () => classifyMainDoorsByWidth(doorLikes, mainDoorWidthOpts),
    [doorLikes, mainDoorWidthOpts],
  );
  const autoSplitSpanPx = useMemo(() => autoMainDoorSplitSpan(doorLikes), [doorLikes]);
  const doorRows = useMemo(
    () =>
      [...doorLikes]
        .sort((a, b) => b.spanPx - a.spanPx)
        .map((door) => ({
          ...door,
          isMain: mainDoorIds.has(door.id),
        })),
    [doorLikes, mainDoorIds],
  );

  const commitExtract = (
    labeled: ExtractedGeometryRoom[],
    roomGraph: RoomGraph,
    method: "overlays" | "image",
    extractWarning: string | null,
  ) => {
    setResult({
      pageKey: key,
      rooms: labeled,
      graph: roomGraph,
      method,
      warning: extractWarning,
    });
    const classifiedWalls = classifyWallEntities(
      entities,
      pixelsPerMeter,
      externalMinMm,
      wallMode,
      externalMinPx,
    );
    const ug = buildUnitGraph({
      rooms: labeled,
      roomGraph,
      walls: classifiedWalls,
      wallEntities: entities,
      pixelsPerMeter,
    });
    setActiveUnitId(ug.units[0]?.id ?? null);
  };

  const groups = useMemo(() => {
    const map = new Map<string, ExtractedGeometryRoom[]>();
    for (const room of pageRooms) {
      const label = room.isCommon ? "Common" : room.unitLabel || "Unassigned";
      const list = map.get(label) ?? [];
      list.push(room);
      map.set(label, list);
    }
    return [...map.entries()];
  }, [pageRooms]);

  const unitGroups = useMemo(
    () => groups.filter(([label]) => label !== "Common"),
    [groups],
  );

  const activeUnitLabel = useMemo(() => {
    const selectedRoom = pageRooms.find((r) => r.id === selectedId);
    if (selectedRoom && !selectedRoom.isCommon) return selectedRoom.unitLabel || "Unassigned";
    if (activeUnitId) {
      const byId = pageRooms.find((r) => r.unitId === activeUnitId);
      if (byId && !byId.isCommon) return byId.unitLabel || "Unassigned";
      if (unitGroups.some(([label]) => label === activeUnitId)) return activeUnitId;
    }
    return unitGroups[0]?.[0] ?? null;
  }, [activeUnitId, pageRooms, selectedId, unitGroups]);

  const visibleGroups = useMemo(() => {
    if (!activeUnitLabel) return groups;
    return groups.filter(([label]) => label === activeUnitLabel);
  }, [activeUnitLabel, groups]);

  const pickUnit = (label: string, list: ExtractedGeometryRoom[]) => {
    setActiveUnitId(list[0]?.unitId ?? label);
    const keep = selectedId && list.some((r) => r.id === selectedId);
    if (!keep) setSelectedId(null);
  };

  const selectedEgo = useMemo(
    () => (pageGraph && selectedId ? egoNeighborhood(pageGraph, selectedId) : null),
    [pageGraph, selectedId],
  );

  const runFromOverlays = () => {
    if (walls < 1 && overlayRooms < 1) {
      setError(
        "Detect rooms or walls first (Detect tab). Extract uses room overlays inside each unit, and flood-fills leftover interiors from walls.",
      );
      return;
    }
    if (unitCount(entities) < 1 && walls > 0) {
      setError(
        "No unit outlines yet. Use Apply to unit boundaries below, then Extract from overlays.",
      );
      return;
    }
    setExtracting(true);
    setError(null);
    try {
      const workingEntities = entities;
      const extracted = extractWallBoundedRooms({
        entities: workingEntities,
        widthPx,
        heightPx,
        pixelsPerMeter,
        mainDoorWidth: mainDoorWidthOptsFromStore(),
      });
      const labeled = drawingOcrLines?.length
        ? labelRoomsFromDetectionAndOcr(extracted, drawingOcrLines, workingEntities).rooms
        : extracted;
      if (!labeled.length) {
        setError(
          unitCount(workingEntities) < 1
            ? "No rooms found from overlays. Detect room types (Bedroom, Bathroom…) or walls that enclose interiors."
            : "No rooms found inside the unit outlines. Detect room types inside each unit, or walls that enclose interiors.",
        );
        return;
      }
      const roomGraph = buildRoomGraph({
        rooms: labeled,
        openings: workingEntities,
        pixelsPerMeter,
      });
      commitExtract(
        labeled,
        roomGraph,
        "overlays",
        unitCount(workingEntities) < 1
          ? "No unit outlines on this page — extracted the whole sheet. Run Detect units for per-apartment rooms."
          : null,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extract failed");
    } finally {
      setExtracting(false);
    }
  };

  const runFromImage = async () => {
    if (!pageImageUrl) {
      setError("Page image is not loaded.");
      return;
    }
    setExtracting(true);
    setError(null);
    try {
      const blob = await fetch(pageImageUrl).then((res) => {
        if (!res.ok) throw new Error("Could not load page image");
        return res.blob();
      });
      const unitPolygons = entities
        .filter((e) => isUnitOutlineEntity(e))
        .map((e) => ({
          id: e.id,
          label: e.label,
          points: overlayGeometryPoints(e.geometry),
        }))
        .filter((u) => u.points.length >= 3);
      const openings = entities
        .filter((e) => (e.type === "door" || e.type === "window") && e.status !== "rejected")
        .map((e) => ({
          type: e.type,
          label: e.label,
          points: overlayGeometryPoints(e.geometry),
        }));
      const result = await extractGeometryFromImage({
        image: blob,
        originalWidth: widthPx,
        originalHeight: heightPx,
        unitPolygons,
        openings,
        pixelsPerMeter,
      });
      const bounded = result.regions.filter((r) => r.attributes.extractMethod === "wall_bounded");
      const rawRooms =
        bounded.length > 0
          ? extractedRoomsFromPolygons(bounded, pixelsPerMeter)
          : extractWallBoundedRooms({
              entities: [
                ...entities.filter(
                  (e) => isUnitOutlineEntity(e) || e.type === "door" || e.type === "window",
                ),
                ...result.regions.map((region) => ({
                  id: region.id,
                  type: region.type,
                  label: region.label,
                  geometry: { kind: "polygon" as const, points: region.polygonPx },
                })),
              ],
              widthPx: result.widthPx || widthPx,
              heightPx: result.heightPx || heightPx,
              pixelsPerMeter,
              mainDoorWidth: mainDoorWidthOptsFromStore(),
            });
      const labeled = drawingOcrLines?.length
        ? labelRoomsFromDetectionAndOcr(rawRooms, drawingOcrLines, entities).rooms
        : rawRooms;
      const roomGraph = buildRoomGraph({
        rooms: labeled,
        openings: entities,
        pixelsPerMeter,
      });
      commitExtract(labeled, roomGraph, "image", result.warning);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image extract failed");
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="space-y-3">
      <HeadingHint
        title="Geometry"
        as="p"
        className="text-xs font-semibold uppercase tracking-wider text-slate-400"
        hint="Extract wall-bounded rooms, explore adjacency and apartment topology (living / dining / kitchen hub). Click a room for neighbours, doors, and ventilation."
      />

      <div className="flex items-center gap-1 text-xs tabular-nums text-slate-500">
        <span>
          {units} unit{units === 1 ? "" : "s"} · {overlayRooms} room{overlayRooms === 1 ? "" : "s"} ·{" "}
          {walls} wall{walls === 1 ? "" : "s"} · {doors} door{doors === 1 ? "" : "s"}
          {!scaled ? " · px" : ""}
        </span>
        {units < 1 ? (
          <HoverHint
            text="No unit outlines yet. After Detect, click Apply to unit boundaries below to infer units from walls, doors, and OCR."
            label="About missing unit outlines"
            align="start"
          />
        ) : null}
        {!scaled ? (
          <HoverHint
            text="No page scale yet — sizes stay in pixels. Set scale in the sidebar to get metres."
            label="About page scale"
            align="start"
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="btn-compact-primary"
          disabled={extracting}
          onClick={runFromOverlays}
        >
          Extract from overlays
        </button>
        <button
          type="button"
          className="btn-compact-secondary"
          disabled={extracting || !pageImageUrl}
          onClick={() => void runFromImage()}
        >
          Extract from image
        </button>
        <label className="ml-auto flex items-center gap-1 text-[13px] text-slate-700">
          <input
            type="checkbox"
            className="accent-slate-900"
            checked={showOverlays}
            onChange={(e) => setShowOverlays(e.target.checked)}
          />
          Overlay / graph
        </label>
      </div>

      {doors > 0 ? (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Main door detection</p>
          <p className="text-xs leading-snug text-slate-600">
            Classifies unit entrances from door opening width (≥ threshold = main, &lt; internal). Room
            extract floods from the main door through internal-door openings only. Tune threshold, then
            extract or apply to unit boundaries.
          </p>
          <label className="block text-xs font-medium text-slate-600">
            Mode
            <select
              className="hl-input mt-1 w-full text-[13px]"
              value={mainDoorMode}
              onChange={(e) => setMainDoorMode(e.target.value as MainDoorWidthMode)}
            >
              <option value="threshold">Min width (px)</option>
              <option value="auto">Auto split by gap</option>
            </select>
          </label>
          {mainDoorMode === "threshold" ? (
            <label className="block text-xs font-medium text-slate-600">
              Min opening width (px)
              <input
                type="range"
                min={0}
                max={200}
                step={1}
                value={mainDoorMinSpanPx}
                onChange={(e) => setMainDoorMinSpanPx(Number(e.target.value))}
                className="mt-1 w-full accent-teal-700"
              />
              <span className="mt-0.5 block tabular-nums text-[13px] text-slate-800">
                {mainDoorMinSpanPx} px
              </span>
            </label>
          ) : (
            <p className="text-xs tabular-nums text-slate-600">
              Auto split at {autoSplitSpanPx != null ? `${autoSplitSpanPx.toFixed(1)} px` : "—"}
            </p>
          )}
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              className="accent-slate-900"
              checked={highlightMainDoors}
              onChange={(e) => setHighlightMainDoors(e.target.checked)}
            />
            Highlight main doors on drawing
          </label>
          <p className="text-xs tabular-nums text-slate-600">
            {mainDoorIds.size} main · {doorLikes.length - mainDoorIds.size} internal
          </p>
          <ul className="max-h-36 space-y-0.5 overflow-y-auto text-xs">
            {doorRows.map((door) => (
              <li
                key={door.id}
                className={cn(
                  "flex items-center justify-between gap-2 rounded px-1 py-0.5",
                  door.isMain ? "bg-orange-50 text-orange-900" : "text-slate-600",
                )}
              >
                <span className="truncate">{door.label || "Door"}</span>
                <span className="shrink-0 tabular-nums">
                  {door.spanPx.toFixed(0)} px · {door.isMain ? "main" : "internal"}
                </span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn-compact-secondary w-full text-xs"
            onClick={() =>
              applyUnitBoundariesFromPage({
                analysisId,
                pageNumber,
                widthPx,
                heightPx,
                drawingOcrMeta: drawingOcrLines?.length ? { lines: drawingOcrLines } : null,
              })
            }
          >
            Apply to unit boundaries
          </button>
        </div>
      ) : null}

      {walls > 0 ? (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Wall class</p>
          <label className="block text-xs font-medium text-slate-600">
            External wall min thickness {scaled ? "(mm)" : "(px)"}
            <input
              type="range"
              min={scaled ? 80 : 0}
              max={scaled ? 300 : 200}
              step={scaled ? 5 : 1}
              value={scaled ? externalMinMm : externalMinPx}
              onChange={(e) =>
                scaled
                  ? setExternalMinMm(Number(e.target.value))
                  : setExternalMinPx(Number(e.target.value))
              }
              className="mt-1 w-full accent-teal-700"
            />
            <span className="mt-0.5 block tabular-nums text-[13px] text-slate-800">
              {scaled ? `${externalMinMm} mm` : `${externalMinPx} px (shorter wall side)`}
              {!scaled && wallMode === "hybrid" ? " · hybrid also uses model labels" : ""}
            </span>
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Classification
            <select
              className="hl-input mt-1 w-full text-[13px]"
              value={wallMode}
              onChange={(e) => setWallMode(e.target.value as WallClassifyMode)}
            >
              <option value="hybrid">Hybrid — model label or thickness</option>
              <option value="thickness">Thickness only</option>
              <option value="label">Model label only</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              className="accent-slate-900"
              checked={colorByThickness}
              onChange={(e) => setColorByThickness(e.target.checked)}
            />
            Color walls on drawing
          </label>
          <div className="flex flex-wrap gap-3 text-xs text-slate-600">
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-4 rounded-sm border border-slate-300"
                style={{ background: wallClassificationSwatch("internal") }}
              />
              Internal
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-4 rounded-sm border border-slate-300"
                style={{ background: wallClassificationSwatch("external") }}
              />
              External
            </span>
          </div>
        </div>
      ) : null}

      {extracting ? <p className="text-xs text-slate-500">Extracting wall-bounded rooms…</p> : null}
      {error ? <p className="text-xs leading-snug text-red-600">{error}</p> : null}
      {warning && !extracting ? (
        <p className="text-xs leading-snug text-amber-700">{warning}</p>
      ) : null}

      {pageRooms.length === 0 && !extracting ? (
        <p className="text-[13px] leading-snug text-slate-500">No extracted rooms yet.</p>
      ) : (
        <div className="space-y-2">
          {unitGroups.length > 1 ? (
            <div className="flex flex-wrap gap-1">
              {unitGroups.map(([label, list]) => (
                <button
                  key={label}
                  type="button"
                  className={cn(
                    "rounded border px-2 py-0.5 text-xs font-medium",
                    activeUnitLabel === label
                      ? "border-teal-700 bg-teal-700 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                  )}
                  onClick={() => pickUnit(label, list)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          {visibleGroups.map(([group, list]) => (
          <div key={group} className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{group}</p>
            {pageGraph && group !== "Common" ? (
              <UnitVentNote graph={pageGraph} rooms={list} />
            ) : null}
            <ul className="space-y-0.5">
              {list.map((room) => {
                const selected = selectedId === room.id;
                return (
                <li key={room.id}>
                  <button
                    type="button"
                    className={cn(
                      "w-full rounded px-1.5 py-1 text-left hover:bg-slate-50",
                      selected ? "bg-teal-50" : "",
                    )}
                    onClick={() => setSelectedId(room.id === selectedId ? null : room.id)}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-sm"
                        style={{ background: classSwatch(room.label) }}
                      />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800">
                        {room.label}
                      </span>
                      <span className="tabular-nums text-xs text-slate-500">
                        {formatArea(room.areaM2, room.areaPx2, scaled)}
                      </span>
                    </div>
                    {selected ? (
                    <p className="pl-3.5 text-xs tabular-nums text-slate-500">
                      {room.labeledSizeText ??
                        `${formatLen(room.widthM, room.widthPx, scaled)} × ${formatLen(room.depthM, room.depthPx, scaled)}`}
                      {room.adjacentLabels.length
                        ? ` · ${room.adjacentLabels.slice(0, 3).join(", ")}`
                        : ""}
                      {room.openings.doors.length ? ` · ${room.openings.doors.length} door` : ""}
                      {room.openings.windows.length ? ` · ${room.openings.windows.length} win` : ""}
                    </p>
                    ) : null}
                  </button>
                </li>
                );
              })}
            </ul>
            {selectedEgo && list.some((r) => r.id === selectedEgo.room.id) ? (
              <RoomEgoCard
                ego={selectedEgo}
                onSelectNeighbor={(id) => setSelectedId(id)}
              />
            ) : null}
          </div>
          ))}
          <UnitGraphSection
            analysisId={analysisId}
            pageNumber={pageNumber}
            entities={entities}
            pixelsPerMeter={pixelsPerMeter}
            drawingOcrLines={drawingOcrLines}
            ocrLinesForTypes={ocrLinesForTypes}
            hasRooms={pageRooms.length > 0}
          />
        </div>
      )}
    </div>
  );
}
