"use client";

import { create } from "zustand";
import type { OverlayEntity } from "@/features/plan-editor/types";
import {
  roomsToOverlayEntities,
  type ExtractedGeometryRoom,
} from "@/lib/geometry/wallBoundedRooms";
import type { RoomGraph } from "@/lib/geometry/roomGraph";

type GeometryExtractState = {
  pageKey: string | null;
  rooms: ExtractedGeometryRoom[];
  graph: RoomGraph | null;
  overlayEntities: OverlayEntity[];
  showOverlays: boolean;
  showGraphOnPlan: boolean;
  activeUnitId: string | null;
  selectedId: string | null;
  extracting: boolean;
  error: string | null;
  warning: string | null;
  lastMethod: "overlays" | "image" | null;
  setShowOverlays: (value: boolean) => void;
  setShowGraphOnPlan: (value: boolean) => void;
  setActiveUnitId: (id: string | null) => void;
  setSelectedId: (id: string | null) => void;
  removeByLabel: (label: string) => void;
  setExtracting: (value: boolean) => void;
  setError: (error: string | null) => void;
  setResult: (args: {
    pageKey: string;
    rooms: ExtractedGeometryRoom[];
    graph?: RoomGraph | null;
    method: "overlays" | "image";
    warning?: string | null;
  }) => void;
  clear: () => void;
};

export const useGeometryExtractStore = create<GeometryExtractState>((set) => ({
  pageKey: null,
  rooms: [],
  graph: null,
  overlayEntities: [],
  showOverlays: false,
  showGraphOnPlan: true,
  activeUnitId: null,
  selectedId: null,
  extracting: false,
  error: null,
  warning: null,
  lastMethod: null,
  setShowOverlays: (showOverlays) => set({ showOverlays }),
  setShowGraphOnPlan: (showGraphOnPlan) => set({ showGraphOnPlan }),
  setActiveUnitId: (activeUnitId) => set({ activeUnitId }),
  setSelectedId: (selectedId) => set({ selectedId }),
  removeByLabel: (label) =>
    set((s) => {
      const needle = label.trim().toLowerCase();
      const rooms = s.rooms.filter((room) => room.label.trim().toLowerCase() !== needle);
      if (rooms.length === s.rooms.length) return s;
      return {
        rooms,
        overlayEntities: roomsToOverlayEntities(rooms),
        graph: s.graph
          ? {
              ...s.graph,
              nodes: rooms,
              edges: s.graph.edges.filter(
                (edge) => rooms.some((r) => r.id === edge.fromId) && rooms.some((r) => r.id === edge.toId),
              ),
            }
          : s.graph,
        selectedId: s.selectedId && rooms.some((r) => r.id === s.selectedId) ? s.selectedId : null,
      };
    }),
  setExtracting: (extracting) => set({ extracting }),
  setError: (error) => set({ error }),
  setResult: ({ pageKey, rooms, graph, method, warning }) =>
    set({
      pageKey,
      rooms,
      graph: graph ?? { nodes: rooms, edges: [] },
      overlayEntities: roomsToOverlayEntities(rooms),
      showOverlays: true,
      activeUnitId: null,
      selectedId: null,
      extracting: false,
      error: null,
      warning: warning ?? null,
      lastMethod: method,
    }),
  clear: () =>
    set({
      pageKey: null,
      rooms: [],
      graph: null,
      overlayEntities: [],
      activeUnitId: null,
      selectedId: null,
      extracting: false,
      error: null,
      warning: null,
      lastMethod: null,
    }),
}));
