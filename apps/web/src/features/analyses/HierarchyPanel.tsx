"use client";

import type { BuildingHierarchy } from "@highlife/shared-types";
import { useMemo, useState } from "react";
import { compareUnitLabels } from "@/lib/hierarchy/buildHierarchy";
import { cn } from "@/lib/utils";

type Props = {
  hierarchy: BuildingHierarchy | null | undefined;
  activePageNumber?: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onSelectFloorPage?: (pageNumber: number) => void;
};

function formatArea(m2: number | null | undefined): string | null {
  if (m2 == null || !Number.isFinite(m2)) return null;
  return `${m2.toFixed(1)} m²`;
}

export function HierarchyPanel({
  hierarchy,
  activePageNumber,
  selectedId,
  onSelect,
  onSelectFloorPage,
}: Props) {
  const [openFloors, setOpenFloors] = useState<Record<string, boolean>>({});
  const [openUnits, setOpenUnits] = useState<Record<string, boolean>>({});

  const roomById = useMemo(() => {
    const map = new Map((hierarchy?.rooms ?? []).map((r) => [r.id, r]));
    return map;
  }, [hierarchy?.rooms]);

  const unitById = useMemo(() => {
    const map = new Map((hierarchy?.units ?? []).map((u) => [u.id, u]));
    return map;
  }, [hierarchy?.units]);

  if (!hierarchy || hierarchy.floors.length === 0) {
    return (
      <div className="space-y-2 text-xs text-slate-500">
        <p className="font-medium text-slate-700">Building hierarchy</p>
        <p>
          Run title block OCR for floor names (e.g. First Floor Plan) and unit labels, then
          Detect for room geometry.
        </p>
      </div>
    );
  }

  const totals = {
    floors: hierarchy.floors.length,
    units: hierarchy.units.length,
    rooms: hierarchy.rooms.filter((r) => !r.isCommon).length,
    common: hierarchy.rooms.filter((r) => r.isCommon).length,
    objects: hierarchy.objects.length,
  };

  return (
    <div className="space-y-3 text-xs">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Building</p>
        <p className="mt-0.5 text-sm font-semibold text-slate-900">{hierarchy.name}</p>
        <p className="mt-1 text-slate-500">
          {totals.floors} floor{totals.floors === 1 ? "" : "s"} · {totals.units} unit
          {totals.units === 1 ? "" : "s"} · {totals.rooms} room{totals.rooms === 1 ? "" : "s"}
          {totals.common ? ` · ${totals.common} common` : ""}
          {totals.objects ? ` · ${totals.objects} openings/objects` : ""}
        </p>
      </div>

      <ul className="space-y-1">
        {hierarchy.floors.map((floor) => {
          const open = openFloors[floor.id] ?? floor.pageNumber === activePageNumber;
          const isActive = floor.pageNumber === activePageNumber;
          return (
            <li key={floor.id} className="rounded border border-slate-200 bg-white">
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 px-2 py-1.5 text-left",
                  isActive ? "bg-slate-50" : "hover:bg-slate-50",
                )}
                onClick={() => {
                  setOpenFloors((s) => ({ ...s, [floor.id]: !open }));
                  onSelectFloorPage?.(floor.pageNumber);
                }}
              >
                <span className="w-3 text-slate-400">{open ? "▾" : "▸"}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-slate-800">
                  {floor.levelName}
                </span>
                <span className="shrink-0 text-[10px] text-slate-400">
                  p{floor.pageNumber} · {floor.properties.unitCount}u
                </span>
              </button>

              {open && (
                <div className="border-t border-slate-100 px-2 py-1.5">
                  {floor.commonAreaIds.length > 0 && (
                    <div className="mb-2">
                      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                        Common areas
                      </p>
                      <ul className="space-y-0.5">
                        {floor.commonAreaIds.map((id) => {
                          const room = roomById.get(id);
                          if (!room) return null;
                          return (
                            <li key={id}>
                              <button
                                type="button"
                                className={cn(
                                  "w-full rounded px-2 py-1 text-left",
                                  selectedId === id
                                    ? "bg-brand-50 text-brand-800"
                                    : "text-slate-600 hover:bg-slate-50",
                                )}
                                onClick={() => onSelect?.(id)}
                              >
                                {room.label}
                                {formatArea(room.areaM2) ? (
                                  <span className="ml-1 text-slate-400">
                                    {formatArea(room.areaM2)}
                                  </span>
                                ) : null}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                    Units
                  </p>
                  <ul className="space-y-1">
                    {[...floor.unitIds]
                      .sort((a, b) =>
                        compareUnitLabels(
                          unitById.get(a)?.label ?? a,
                          unitById.get(b)?.label ?? b,
                        ),
                      )
                      .map((uid) => {
                      const unit = unitById.get(uid);
                      if (!unit) return null;
                      const uOpen = openUnits[uid] ?? true;
                      return (
                        <li key={uid} className="rounded border border-slate-100">
                          <button
                            type="button"
                            className={cn(
                              "flex w-full items-center gap-1 px-2 py-1 text-left",
                              selectedId === uid
                                ? "bg-brand-50 text-brand-800"
                                : "hover:bg-slate-50",
                            )}
                            onClick={() => {
                              setOpenUnits((s) => ({ ...s, [uid]: !uOpen }));
                              onSelect?.(uid);
                            }}
                          >
                            <span className="w-3 text-slate-400">{uOpen ? "▾" : "▸"}</span>
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {unit.label}
                              {unit.id.startsWith("ocr-unit-") ? (
                                <span className="ml-1 font-normal text-slate-400">· OCR</span>
                              ) : null}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {unit.roomIds.length}r
                              {unit.bedroomCount ? ` · ${unit.bedroomCount}bed` : ""}
                            </span>
                          </button>
                          {uOpen && (
                            <ul className="border-t border-slate-50 px-2 py-1">
                              {unit.roomIds.map((rid) => {
                                const room = roomById.get(rid);
                                if (!room) return null;
                                return (
                                  <li key={rid}>
                                    <button
                                      type="button"
                                      className={cn(
                                        "flex w-full items-center justify-between rounded px-2 py-1 text-left",
                                        selectedId === rid
                                          ? "bg-brand-50 text-brand-800"
                                          : "text-slate-600 hover:bg-slate-50",
                                      )}
                                      onClick={() => onSelect?.(rid)}
                                    >
                                      <span className="truncate">{room.label}</span>
                                      {room.objectIds.length > 0 && (
                                        <span className="ml-2 shrink-0 text-[10px] text-slate-400">
                                          {room.objectIds.length} obj
                                        </span>
                                      )}
                                    </button>
                                  </li>
                                );
                              })}
                              {unit.roomIds.length === 0 && (
                                <li className="px-2 py-1 text-slate-400">No rooms assigned</li>
                              )}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                    {floor.unitIds.length === 0 && (
                      <li className="px-1 py-1 text-slate-400">No units on this floor</li>
                    )}
                  </ul>

                  {floor.unassignedRoomIds.length > 0 && (
                    <div className="mt-2">
                      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-amber-600">
                        Unassigned rooms
                      </p>
                      <ul className="space-y-0.5">
                        {floor.unassignedRoomIds.map((id) => {
                          const room = roomById.get(id);
                          if (!room) return null;
                          return (
                            <li key={id}>
                              <button
                                type="button"
                                className={cn(
                                  "w-full rounded px-2 py-1 text-left text-amber-800",
                                  selectedId === id ? "bg-amber-50" : "hover:bg-amber-50/50",
                                )}
                                onClick={() => onSelect?.(id)}
                              >
                                {room.label}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
