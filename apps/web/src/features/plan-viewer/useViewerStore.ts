"use client";

import { create } from "zustand";
import type { ViewerLayer } from "@highlife/shared-types";

interface ViewerState {
  zoom: number;
  panX: number;
  panY: number;
  selectedId: string | null;
  visibleLayers: Record<ViewerLayer, boolean>;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  resetView: () => void;
  selectObject: (id: string | null) => void;
  toggleLayer: (layer: ViewerLayer) => void;
}

const DEFAULT_LAYERS: Record<ViewerLayer, boolean> = {
  original: true,
  walls: false,
  doors: true,
  windows: false,
  rooms: true,
  commonCorridor: true,
  privateHalls: false,
  unitBoundaries: true,
  unitEntrances: true,
  balconies: true,
  uncertain: true,
  complianceEvidence: false,
};

export const useViewerStore = create<ViewerState>((set) => ({
  zoom: 1,
  panX: 0,
  panY: 0,
  selectedId: null,
  visibleLayers: { ...DEFAULT_LAYERS },
  setZoom: (zoom) => set({ zoom: Math.min(5, Math.max(0.2, zoom)) }),
  setPan: (panX, panY) => set({ panX, panY }),
  resetView: () => set({ zoom: 1, panX: 0, panY: 0 }),
  selectObject: (selectedId) => set({ selectedId }),
  toggleLayer: (layer) =>
    set((state) => ({
      visibleLayers: {
        ...state.visibleLayers,
        [layer]: !state.visibleLayers[layer],
      },
    })),
}));
