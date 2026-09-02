"use client";

import { useEffect, useMemo } from "react";
import type { OverlayEntity } from "@/features/plan-editor/types";
import { pageKey } from "@/features/plan-editor/useOverlayStore";
import { useWallClassificationStore } from "@/features/plan-editor/useWallClassificationStore";
import { buildUnitGraph, type UnitGraph } from "@/lib/geometry/buildUnitGraph";
import { classifyWallEntities } from "@/lib/geometry/classifyWallEntities";
import { labelRoomsFromDetectionAndOcr } from "@/lib/geometry/labelRoomsFromDetectionAndOcr";
import {
  buildAllSemanticTopologies,
  type SemanticUnitTopology,
} from "@/lib/geometry/semanticUnitTopology";
import type { DrawingOcrLine } from "@/lib/hierarchy/inferUnitBoundaries";
import { parseApartmentTypesFromLines, type ApartmentTypeLine } from "@/lib/hierarchy/apartmentType";
import { useGeometryExtractStore } from "./useGeometryExtractStore";

export function useUnitGraphView(args: {
  analysisId: string;
  pageNumber: number;
  entities: OverlayEntity[];
  pixelsPerMeter: number | null;
  drawingOcrLines?: DrawingOcrLine[] | null;
  /** Title-block + drawing OCR for apartment type text (3B, Studio…). */
  ocrLinesForTypes?: ApartmentTypeLine[] | null;
}) {
  const { analysisId, pageNumber, entities, pixelsPerMeter, drawingOcrLines, ocrLinesForTypes } = args;
  const key = pageKey(analysisId, pageNumber);

  const externalMinMm = useWallClassificationStore((s) => s.externalMinMm);
  const externalMinPx = useWallClassificationStore((s) => s.externalMinPx);
  const mode = useWallClassificationStore((s) => s.mode);

  const storePageKey = useGeometryExtractStore((s) => s.pageKey);
  const rooms = useGeometryExtractStore((s) => s.rooms);
  const graph = useGeometryExtractStore((s) => s.graph);
  const activeUnitId = useGeometryExtractStore((s) => s.activeUnitId);
  const setActiveUnitId = useGeometryExtractStore((s) => s.setActiveUnitId);

  const classifiedWalls = useMemo(
    () => classifyWallEntities(entities, pixelsPerMeter, externalMinMm, mode, externalMinPx),
    [entities, pixelsPerMeter, externalMinMm, externalMinPx, mode],
  );

  const pageRooms = storePageKey === key ? rooms : [];
  const pageGraph = storePageKey === key ? graph : null;

  const { enrichedRooms, spatialOcrRooms } = useMemo(() => {
    const merged = labelRoomsFromDetectionAndOcr(pageRooms, drawingOcrLines, entities);
    return { enrichedRooms: merged.rooms, spatialOcrRooms: merged.ocrRooms };
  }, [pageRooms, drawingOcrLines, entities]);

  const unitGraph = useMemo((): UnitGraph | null => {
    if (!pageGraph || enrichedRooms.length === 0) return null;
    return buildUnitGraph({
      rooms: enrichedRooms,
      roomGraph: pageGraph,
      walls: classifiedWalls,
      wallEntities: entities,
      pixelsPerMeter,
    });
  }, [enrichedRooms, pageGraph, classifiedWalls, entities, pixelsPerMeter]);

  const semanticTopologies = useMemo(() => {
    if (!unitGraph || !pageGraph) return [];
    const typeHits = parseApartmentTypesFromLines(ocrLinesForTypes);
    return buildAllSemanticTopologies({
      unitGraph,
      roomGraph: pageGraph,
      typeHits,
    });
  }, [unitGraph, pageGraph, ocrLinesForTypes]);

  const activeUnit =
    unitGraph?.units.find((u) => u.id === activeUnitId) ?? unitGraph?.units[0] ?? null;

  const activeTopology =
    semanticTopologies.find((t) => t.unitId === activeUnitId) ??
    semanticTopologies.find((t) => t.unitLabel === activeUnit?.label) ??
    null;

  useEffect(() => {
    if (!unitGraph?.units.length) return;
    if (activeUnitId && unitGraph.units.some((u) => u.id === activeUnitId)) return;
    setActiveUnitId(unitGraph.units[0].id);
  }, [unitGraph, activeUnitId, setActiveUnitId]);

  return {
    unitGraph,
    activeUnit,
    activeTopology,
    activeUnitId: activeUnit?.id ?? null,
    setActiveUnitId,
    spatialOcrRooms,
    pageRooms,
    enrichedRooms,
  };
}

export type { SemanticUnitTopology, UnitGraph };
