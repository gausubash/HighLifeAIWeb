"use client";

import { HeadingHint } from "@/components/ui/HoverHint";
import type { OverlayEntity } from "@/features/plan-editor/types";
import type { DrawingOcrLine } from "@/lib/hierarchy/inferUnitBoundaries";
import type { ApartmentTypeLine } from "@/lib/hierarchy/apartmentType";
import { useGeometryExtractStore } from "./useGeometryExtractStore";
import { UnitGraphSection } from "./UnitGraphSection";

type Props = {
  analysisId: string;
  pageNumber: number;
  entities: OverlayEntity[];
  pixelsPerMeter: number | null;
  drawingOcrLines?: DrawingOcrLine[] | null;
  ocrLinesForTypes?: ApartmentTypeLine[] | null;
};

export function GraphPanel({
  analysisId,
  pageNumber,
  entities,
  pixelsPerMeter,
  drawingOcrLines,
  ocrLinesForTypes,
}: Props) {
  const rooms = useGeometryExtractStore((s) => s.rooms);
  const showGraphOnPlan = useGeometryExtractStore((s) => s.showGraphOnPlan);
  const setShowGraphOnPlan = useGeometryExtractStore((s) => s.setShowGraphOnPlan);
  const hasRooms = rooms.length > 0;

  return (
    <div className="space-y-3">
      <HeadingHint
        title="Graph"
        as="p"
        className="text-xs font-semibold uppercase tracking-wider text-slate-400"
        hint="Apartment adjacency and living / dining / kitchen topology. Extract rooms on Geometry first. Click a room to highlight it on the plan."
      />

      <label className="flex items-center gap-1.5 text-[13px] text-slate-700">
        <input
          type="checkbox"
          className="accent-slate-900"
          checked={showGraphOnPlan}
          onChange={(e) => setShowGraphOnPlan(e.target.checked)}
        />
        Show graph on plan
      </label>

      {hasRooms ? (
        <UnitGraphSection
          analysisId={analysisId}
          pageNumber={pageNumber}
          entities={entities}
          pixelsPerMeter={pixelsPerMeter}
          drawingOcrLines={drawingOcrLines}
          ocrLinesForTypes={ocrLinesForTypes}
          hasRooms
        />
      ) : (
        <p className="text-xs leading-snug text-slate-500">
          Extract rooms on the Geometry tab first. The unit adjacency graph and plan overlay appear
          here.
        </p>
      )}
    </div>
  );
}
