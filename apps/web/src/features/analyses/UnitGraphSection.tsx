"use client";

import { cn } from "@/lib/utils";
import type { OverlayEntity } from "@/features/plan-editor/types";
import type { DrawingOcrLine } from "@/lib/hierarchy/inferUnitBoundaries";
import type { ApartmentTypeLine } from "@/lib/hierarchy/apartmentType";
import type { SemanticLinkKind, SemanticUnitTopology } from "@/lib/geometry/semanticUnitTopology";
import { useGeometryExtractStore } from "./useGeometryExtractStore";
import { useUnitGraphView } from "./useUnitGraphView";

type Props = {
  analysisId: string;
  pageNumber: number;
  entities: OverlayEntity[];
  pixelsPerMeter: number | null;
  drawingOcrLines?: DrawingOcrLine[] | null;
  ocrLinesForTypes?: ApartmentTypeLine[] | null;
  hasRooms: boolean;
};

function linkLabel(link: SemanticLinkKind | undefined): string {
  if (link === "door") return "door";
  if (link === "shared_wall") return "wall";
  if (link === "inferred") return "inferred";
  return "";
}

function hubAccentClass(role: SemanticUnitTopology["nodes"][number]["role"] | undefined): string {
  if (role === "kitchen") return "text-amber-700";
  if (role === "dining") return "text-violet-700";
  return "text-emerald-700";
}

function TopologyTree({ topology }: { topology: SemanticUnitTopology }) {
  const hub = topology.livingNodeId;
  const hubNode = topology.nodes.find((n) => n.id === hub);
  const typeNode = topology.nodes.find((n) => n.role === "apartment_type");
  const satellites = topology.nodes.filter((n) => n.role !== "apartment_type" && n.id !== hub);

  function edgeTo(targetId: string) {
    return topology.edges.find((e) => e.toId === targetId);
  }

  return (
    <ul className="space-y-1 font-mono text-[11px] text-slate-700">
      {typeNode ? (
        <li>
          <span className="font-semibold text-violet-700">{typeNode.label}</span>
          {topology.expectedBedrooms != null ? (
            <span className="text-slate-500"> · {topology.expectedBedrooms} bed type</span>
          ) : null}
          {hubNode ? (
            <ul className="ml-3 border-l border-slate-200 pl-2">
              <li>
                <span className={cn("font-medium", hubAccentClass(hubNode.role))}>{hubNode.label}</span>
                <span className="text-slate-500"> ← {linkLabel(edgeTo(hubNode.id)?.link)}</span>
                {satellites.length ? (
                  <ul className="ml-3 border-l border-slate-200 pl-2">
                    {satellites.map((sat) => (
                      <li key={sat.id}>
                        <span>{sat.label}</span>
                        <span className="text-slate-500"> ← {linkLabel(edgeTo(sat.id)?.link)}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            </ul>
          ) : satellites.length ? (
            <ul className="ml-3 border-l border-slate-200 pl-2">
              {satellites.map((sat) => (
                <li key={sat.id}>
                  <span>{sat.label}</span>
                  <span className="text-slate-500"> ← {linkLabel(edgeTo(sat.id)?.link)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ) : hubNode ? (
        <li>
          <span className={cn("font-medium", hubAccentClass(hubNode.role))}>{hubNode.label}</span>
          <ul className="ml-3 border-l border-slate-200 pl-2">
            {satellites.map((sat) => (
              <li key={sat.id}>
                <span>{sat.label}</span>
                <span className="text-slate-500"> ← {linkLabel(edgeTo(sat.id)?.link)}</span>
              </li>
            ))}
          </ul>
        </li>
      ) : (
        satellites.map((sat) => (
          <li key={sat.id}>
            <span>{sat.label}</span>
          </li>
        ))
      )}
    </ul>
  );
}

export function UnitGraphSection({
  analysisId,
  pageNumber,
  entities,
  pixelsPerMeter,
  drawingOcrLines,
  ocrLinesForTypes,
  hasRooms,
}: Props) {
  const selectedId = useGeometryExtractStore((s) => s.selectedId);
  const setSelectedId = useGeometryExtractStore((s) => s.setSelectedId);

  const {
    unitGraph,
    activeUnit,
    activeTopology,
    setActiveUnitId: pickUnit,
    spatialOcrRooms,
  } = useUnitGraphView({
    analysisId,
    pageNumber,
    entities,
    pixelsPerMeter,
    drawingOcrLines,
    ocrLinesForTypes,
  });

  if (!hasRooms) return null;

  if (!unitGraph || unitGraph.units.length === 0) {
    return (
      <p className="text-xs leading-snug text-slate-500">
        Could not build a unit adjacency graph from the current room extract.
      </p>
    );
  }

  const activeRooms =
    unitGraph.nodes.filter(
      (n) => n.unitId === activeUnit?.id || n.unitLabel === activeUnit?.label,
    ) ?? [];

  return (
    <div className="space-y-2">
      <p className="text-xs tabular-nums text-slate-500">
        {unitGraph.units.length} unit{unitGraph.units.length === 1 ? "" : "s"} ·{" "}
        {unitGraph.nodes.length} room{unitGraph.nodes.length === 1 ? "" : "s"} ·{" "}
        {unitGraph.edges.length} link{unitGraph.edges.length === 1 ? "" : "s"}
      </p>
      {unitGraph.units.length > 1 ? (
        <div className="flex flex-wrap gap-1">
          {unitGraph.units.map((unit) => (
            <button
              key={unit.id}
              type="button"
              className={cn(
                "rounded border px-2 py-0.5 text-xs font-medium",
                activeUnit?.id === unit.id
                  ? "border-teal-700 bg-teal-700 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
              )}
              onClick={() => pickUnit(unit.id)}
            >
              {unit.label}
            </button>
          ))}
        </div>
      ) : null}
      {activeUnit && activeTopology ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-600">
            {activeUnit.roomIds.length} rooms · {activeUnit.externalWallCount} touch external walls
            {activeTopology.apartmentType ? (
              <>
                {" "}
                · Type <span className="font-medium">{activeTopology.apartmentType}</span>
              </>
            ) : null}
          </p>
          {activeTopology.expectedBedrooms != null ? (
            <p
              className={cn(
                "text-xs tabular-nums",
                activeTopology.detectedBedrooms === activeTopology.expectedBedrooms
                  ? "text-emerald-700"
                  : "text-amber-800",
              )}
            >
              Bedrooms: {activeTopology.detectedBedrooms} detected · {activeTopology.expectedBedrooms}{" "}
              expected
              {activeTopology.detectedBedrooms === activeTopology.expectedBedrooms
                ? " — matches type"
                : activeTopology.detectedBedrooms === 0
                  ? " — label bedrooms from detection/OCR"
                  : " — mismatch"}
            </p>
          ) : activeTopology.detectedBedrooms > 0 ? (
            <p className="text-xs text-slate-600">
              {activeTopology.detectedBedrooms} bedroom
              {activeTopology.detectedBedrooms === 1 ? "" : "s"} labelled
            </p>
          ) : null}
          {activeTopology.warnings.length ? (
            <ul className="space-y-0.5 rounded border border-amber-200 bg-amber-50 px-2 py-1.5">
              {activeTopology.warnings.map((w) => (
                <li key={w} className="text-xs text-amber-900">
                  {w}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Apartment topology
            </p>
            <div className="mt-1">
              <TopologyTree topology={activeTopology} />
            </div>
          </div>
          {spatialOcrRooms.filter(
            (r) => r.unitId === activeUnit.id || r.unitLabel === activeUnit.label,
          ).length > 0 ? (
            <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                OCR room labels
              </p>
              <ul className="mt-1 space-y-0.5">
                {spatialOcrRooms
                  .filter((r) => r.unitId === activeUnit.id || r.unitLabel === activeUnit.label)
                  .map((r) => (
                    <li key={r.id} className="text-xs text-slate-700">
                      <span className="font-medium">{r.label}</span>
                      <span className="text-slate-500"> — {r.text}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
          {activeRooms.length > 0 ? (
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Graph rooms
              </p>
              <ul className="space-y-0.5">
                {activeRooms.map((room) => (
                  <li key={room.id}>
                    <button
                      type="button"
                      className={cn(
                        "w-full rounded px-1.5 py-0.5 text-left text-xs hover:bg-slate-50",
                        selectedId === room.id ? "bg-teal-50 font-medium" : "text-slate-700",
                      )}
                      onClick={() => setSelectedId(room.id === selectedId ? null : room.id)}
                    >
                      {room.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
