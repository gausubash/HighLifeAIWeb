"use client";

import type { BuildingHierarchy, HierarchyObjectKind } from "@highlife/shared-types";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { compareUnitLabels } from "@/lib/hierarchy/buildHierarchy";
import { computeRoomProperties } from "@/lib/hierarchy/roomProperties";
import { classSwatch } from "@/features/plan-editor/styles";
import { cn } from "@/lib/utils";
import type { OverlayEntity } from "@/features/plan-editor/types";

type Props = {
  hierarchy: BuildingHierarchy | null | undefined;
  activePageNumber?: number;
  selectedId?: string | null;
  entities?: OverlayEntity[];
  pixelsPerMeter?: number | null;
  onSelect?: (id: string) => void;
  onSelectFloorPage?: (pageNumber: number) => void;
  onAddUnit?: (pageNumber: number, raw: string) => boolean;
  onRemoveUnit?: (pageNumber: number, unitLabel: string) => void;
};

const OBJECT_DOT: Record<HierarchyObjectKind, string> = {
  door: "#ea580c",
  window: "#06b6d4",
  fixture: "#84cc16",
  stair: "#64748b",
  other: "#94a3b8",
};

function formatArea(m2: number | null | undefined): string | null {
  if (m2 == null || !Number.isFinite(m2)) return null;
  return `${m2 >= 10 ? m2.toFixed(0) : m2.toFixed(1)} m²`;
}

function formatLen(m: number | null | undefined, px: number): string {
  if (m != null && Number.isFinite(m)) {
    return m >= 10 ? `${m.toFixed(1)} m` : `${m.toFixed(2)} m`;
  }
  return `${px.toFixed(0)} px`;
}

function formatAreaOrPx(m2: number | null | undefined, px2: number, scaled: boolean): string {
  const pretty = formatArea(m2);
  if (pretty) return pretty;
  if (!scaled && px2 > 0) return `${px2.toFixed(0)} px²`;
  return "—";
}

function Swatch({ color, size = "h-2 w-2" }: { color: string; size?: string }) {
  return (
    <span
      className={cn("inline-block shrink-0 rounded-sm", size)}
      style={{ background: color }}
    />
  );
}

function TreeButton({
  selected,
  onClick,
  children,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-1 rounded px-1 py-0.5 text-left",
        selected ? "bg-teal-50 text-teal-900" : "text-slate-700 hover:bg-slate-50",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function HierarchyPanel({
  hierarchy,
  activePageNumber,
  selectedId,
  entities = [],
  pixelsPerMeter = null,
  onSelect,
  onSelectFloorPage,
  onAddUnit,
  onRemoveUnit,
}: Props) {
  const [openFloors, setOpenFloors] = useState<Record<string, boolean>>({});
  const [openUnits, setOpenUnits] = useState<Record<string, boolean>>({});
  const [unitDraft, setUnitDraft] = useState("");
  const [unitError, setUnitError] = useState<string | null>(null);

  const roomById = useMemo(
    () => new Map((hierarchy?.rooms ?? []).map((r) => [r.id, r])),
    [hierarchy?.rooms],
  );
  const unitById = useMemo(
    () => new Map((hierarchy?.units ?? []).map((u) => [u.id, u])),
    [hierarchy?.units],
  );
  const objectById = useMemo(
    () => new Map((hierarchy?.objects ?? []).map((o) => [o.id, o])),
    [hierarchy?.objects],
  );

  const selectedRoomFacts = useMemo(() => {
    if (!hierarchy || !selectedId) return null;
    return computeRoomProperties({
      roomId: selectedId,
      hierarchy,
      entities,
      pixelsPerMeter,
    });
  }, [entities, hierarchy, pixelsPerMeter, selectedId]);

  const selectedUnit = selectedId ? unitById.get(selectedId) ?? null : null;

  if (!hierarchy || hierarchy.floors.length === 0) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Tree</p>
        <p className="text-[13px] leading-snug text-slate-500">
          Detect walls/doors, then use Geometry to infer units, extract rooms, and build the graph.
        </p>
      </div>
    );
  }

  const totals = {
    floors: hierarchy.floors.length,
    units: hierarchy.units.length,
    rooms: hierarchy.rooms.filter((r) => !r.isCommon).length,
    common: hierarchy.rooms.filter((r) => r.isCommon).length,
  };

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Building</p>
        <p className="truncate text-[14px] font-semibold text-slate-900">{hierarchy.name}</p>
        <div className="flex flex-wrap gap-1">
          {(
            [
              [totals.floors, "floors", "#64748b"],
              [totals.units, "units", "#a855f7"],
              [totals.rooms, "rooms", "#2563eb"],
              totals.common ? [totals.common, "common", "#eab308"] : null,
            ] as ([number, string, string] | null)[]
          )
            .filter((item): item is [number, string, string] => item != null && item[0] > 0)
            .map(([count, label, color]) => (
              <span
                key={label}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-xs tabular-nums text-slate-600"
              >
                <Swatch color={color} />
                {count} {label}
              </span>
            ))}
        </div>
      </div>

      {selectedRoomFacts ? (
        <div className="space-y-1.5 rounded-md border border-teal-200 bg-teal-50/50 px-2 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">
            {selectedRoomFacts.label}
            {selectedRoomFacts.unitLabel ? ` · ${selectedRoomFacts.unitLabel}` : ""}
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[13px] text-slate-700">
            <dt className="text-slate-500">Area</dt>
            <dd className="tabular-nums">
              {formatAreaOrPx(selectedRoomFacts.areaM2, selectedRoomFacts.areaPx2, selectedRoomFacts.scaled)}
            </dd>
            <dt className="text-slate-500">Size</dt>
            <dd className="tabular-nums">
              {selectedRoomFacts.labeledSizeText ??
                `${formatLen(selectedRoomFacts.widthM, selectedRoomFacts.widthPx)} × ${formatLen(selectedRoomFacts.depthM, selectedRoomFacts.depthPx)}`}
            </dd>
            <dt className="text-slate-500">Perimeter</dt>
            <dd className="tabular-nums">
              {formatLen(selectedRoomFacts.perimeterM, 2 * (selectedRoomFacts.widthPx + selectedRoomFacts.depthPx))}
            </dd>
            <dt className="text-slate-500">Adjacent</dt>
            <dd>
              {selectedRoomFacts.adjacent.length
                ? selectedRoomFacts.adjacent
                    .map((n) => (n.sameUnit ? n.label : `${n.label} (other unit)`))
                    .join(", ")
                : "None detected"}
            </dd>
            <dt className="text-slate-500">Openings</dt>
            <dd>
              {[
                selectedRoomFacts.openings.doors.length
                  ? `${selectedRoomFacts.openings.doors.length} door${selectedRoomFacts.openings.doors.length === 1 ? "" : "s"}`
                  : null,
                selectedRoomFacts.openings.windows.length
                  ? `${selectedRoomFacts.openings.windows.length} window${selectedRoomFacts.openings.windows.length === 1 ? "" : "s"}`
                  : null,
                selectedRoomFacts.openings.fixtures.length
                  ? `${selectedRoomFacts.openings.fixtures.length} fixture${selectedRoomFacts.openings.fixtures.length === 1 ? "" : "s"}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ") || "None inside this polygon"}
            </dd>
          </dl>
          {!selectedRoomFacts.scaled ? (
            <p className="text-xs leading-snug text-amber-800">
              Calibrate scale on this sheet to convert pixels into metres.
            </p>
          ) : null}
        </div>
      ) : selectedUnit ? (
        <div className="space-y-1.5 rounded-md border border-teal-200 bg-teal-50/50 px-2 py-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">{selectedUnit.label}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-[13px] text-slate-700">
            <dt className="text-slate-500">Area</dt>
            <dd className="tabular-nums">{formatArea(selectedUnit.areaM2) ?? "—"}</dd>
            <dt className="text-slate-500">Rooms</dt>
            <dd className="tabular-nums">{selectedUnit.roomIds.length}</dd>
            <dt className="text-slate-500">Beds</dt>
            <dd className="tabular-nums">{selectedUnit.bedroomCount}</dd>
            <dt className="text-slate-500">Baths</dt>
            <dd className="tabular-nums">{selectedUnit.bathroomCount}</dd>
          </dl>
        </div>
      ) : null}

      <ul className="space-y-1">
        {hierarchy.floors.map((floor) => {
          const open = openFloors[floor.id] ?? floor.pageNumber === activePageNumber;
          const isActive = floor.pageNumber === activePageNumber;
          return (
            <li key={floor.id}>
              <TreeButton
                selected={isActive}
                onClick={() => {
                  setOpenFloors((s) => ({ ...s, [floor.id]: !open }));
                  onSelectFloorPage?.(floor.pageNumber);
                }}
              >
                <span className="w-3 shrink-0 text-xs text-slate-400">{open ? "▾" : "▸"}</span>
                <Swatch color="#64748b" size="h-2.5 w-2.5" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{floor.levelName}</span>
                <span className="shrink-0 text-xs tabular-nums text-slate-400">
                  p{floor.pageNumber}
                  {floor.properties.unitCount ? ` · ${floor.properties.unitCount}u` : ""}
                </span>
              </TreeButton>

              {open ? (
                <div className="ml-2 border-l border-slate-200 pl-2">
                  {floor.commonAreaIds.length > 0 ? (
                    <div className="mt-0.5">
                      <p className="px-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Common
                      </p>
                      <ul>
                        {floor.commonAreaIds.map((id) => {
                          const room = roomById.get(id);
                          if (!room) return null;
                          return (
                            <li key={id}>
                              <TreeButton selected={selectedId === id} onClick={() => onSelect?.(id)}>
                                <Swatch color={classSwatch(room.roomType || room.label)} />
                                <span className="min-w-0 flex-1 truncate text-[13px]">{room.label}</span>
                                {formatArea(room.areaM2) ? (
                                  <span className="shrink-0 text-xs tabular-nums text-slate-400">
                                    {formatArea(room.areaM2)}
                                  </span>
                                ) : null}
                              </TreeButton>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}

                  <p className="mt-0.5 px-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Units
                  </p>
                  {onAddUnit && floor.pageNumber === activePageNumber ? (
                    <form
                      className="mb-1 flex items-center gap-1 px-1"
                      onSubmit={(e: FormEvent) => {
                        e.preventDefault();
                        const ok = onAddUnit(floor.pageNumber, unitDraft);
                        if (ok) {
                          setUnitDraft("");
                          setUnitError(null);
                        } else {
                          setUnitError("Use 101, 12B, or A");
                        }
                      }}
                    >
                      <input
                        value={unitDraft}
                        onChange={(e) => {
                          setUnitDraft(e.target.value);
                          if (unitError) setUnitError(null);
                        }}
                        placeholder="Add unit…"
                        aria-label="Add unit id"
                        className="h-6 min-w-0 flex-1 rounded border border-slate-300 px-1.5 text-[13px] text-slate-800"
                      />
                      <button
                        type="submit"
                        className="h-6 shrink-0 rounded border border-slate-300 px-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Add
                      </button>
                    </form>
                  ) : null}
                  {unitError && floor.pageNumber === activePageNumber ? (
                    <p className="px-1 text-xs text-amber-700">{unitError}</p>
                  ) : null}
                  <ul className="space-y-0.5">
                    {[...floor.unitIds]
                      .sort((a, b) =>
                        compareUnitLabels(unitById.get(a)?.label ?? a, unitById.get(b)?.label ?? b),
                      )
                      .map((uid) => {
                        const unit = unitById.get(uid);
                        if (!unit) return null;
                        const uOpen =
                          openUnits[uid] ??
                          (selectedId === uid || unit.roomIds.includes(selectedId ?? ""));
                        return (
                          <li key={uid}>
                            <div className="flex items-center gap-0.5">
                              <TreeButton
                                selected={selectedId === uid}
                                onClick={() => {
                                  setOpenUnits((s) => ({ ...s, [uid]: !uOpen }));
                                  onSelect?.(uid);
                                }}
                              >
                                <span className="w-3 shrink-0 text-xs text-slate-400">
                                  {uOpen ? "▾" : "▸"}
                                </span>
                                <Swatch color="#a855f7" />
                                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                                  {unit.label}
                                </span>
                                <span className="shrink-0 text-xs tabular-nums text-slate-400">
                                  {unit.roomIds.length}r
                                </span>
                              </TreeButton>
                              {onRemoveUnit && unit.id.startsWith("ocr-unit-") ? (
                                <button
                                  type="button"
                                  className="h-5 w-5 shrink-0 text-[14px] text-slate-400 hover:text-red-600"
                                  aria-label={`Remove ${unit.label}`}
                                  onClick={() => onRemoveUnit(floor.pageNumber, unit.label)}
                                >
                                  ×
                                </button>
                              ) : null}
                            </div>
                            {uOpen ? (
                              <ul className="ml-3 border-l border-violet-100 pl-1.5">
                                {unit.roomIds.map((rid) => {
                                  const room = roomById.get(rid);
                                  if (!room) return null;
                                  const objects = room.objectIds
                                    .map((oid) => objectById.get(oid))
                                    .filter(Boolean);
                                  return (
                                    <li key={rid}>
                                      <TreeButton
                                        selected={selectedId === rid}
                                        onClick={() => onSelect?.(rid)}
                                      >
                                        <Swatch color={classSwatch(room.roomType || room.label)} />
                                        <span className="min-w-0 flex-1 truncate text-[13px]">
                                          {room.label}
                                        </span>
                                        {objects.length > 0 ? (
                                          <span className="flex shrink-0 items-center gap-0.5">
                                            {objects.slice(0, 4).map((obj) => (
                                              <Swatch
                                                key={obj!.id}
                                                color={OBJECT_DOT[obj!.kind] ?? OBJECT_DOT.other}
                                                size="h-1.5 w-1.5 rounded-full"
                                              />
                                            ))}
                                          </span>
                                        ) : null}
                                        {formatArea(room.areaM2) ? (
                                          <span className="shrink-0 text-xs tabular-nums text-slate-400">
                                            {formatArea(room.areaM2)}
                                          </span>
                                        ) : null}
                                      </TreeButton>
                                    </li>
                                  );
                                })}
                                {unit.roomIds.length === 0 ? (
                                  <li className="px-1 py-0.5 text-xs text-slate-400">No rooms</li>
                                ) : null}
                              </ul>
                            ) : null}
                          </li>
                        );
                      })}
                    {floor.unitIds.length === 0 ? (
                      <li className="px-1 py-0.5 text-xs text-slate-400">
                        No units — type an id if OCR missed it.
                      </li>
                    ) : null}
                  </ul>

                  {floor.unassignedRoomIds.length > 0 ? (
                    <div className="mt-1">
                      <p className="px-1 text-xs font-semibold uppercase tracking-wider text-amber-600">
                        Unassigned
                      </p>
                      <ul>
                        {floor.unassignedRoomIds.map((id) => {
                          const room = roomById.get(id);
                          if (!room) return null;
                          return (
                            <li key={id}>
                              <TreeButton
                                selected={selectedId === id}
                                onClick={() => onSelect?.(id)}
                              >
                                <Swatch color={classSwatch(room.roomType || room.label)} />
                                <span className="min-w-0 flex-1 truncate text-[13px] text-amber-800">
                                  {room.label}
                                </span>
                              </TreeButton>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
