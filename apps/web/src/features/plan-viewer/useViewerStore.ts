"use client";

import { create } from "zustand";
import type { ViewerLayer } from "@highlife/shared-types";
import { clampZoom } from "./viewBounds";

interface ViewerState {
  zoom: number;
  panX: number;
  panY: number;
  pageIndex: number;
  selectedId: string | null;
  visibleLayers: Record<ViewerLayer, boolean>;
  /** Show OCR line boxes and labels drawn on the plan image. */
  showOcrText: boolean;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  setPageIndex: (index: number) => void;
  resetView: () => void;
  selectObject: (id: string | null) => void;
  toggleLayer: (layer: ViewerLayer) => void;
  toggleShowOcrText: () => void;
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
  pageIndex: 0,
  selectedId: null,
  visibleLayers: { ...DEFAULT_LAYERS },
  showOcrText: true,
  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
  setPan: (panX, panY) => set({ panX, panY }),
  setPageIndex: (pageIndex) => set({ pageIndex, zoom: 1, panX: 0, panY: 0 }),
  resetView: () => set({ zoom: 1, panX: 0, panY: 0 }),
  selectObject: (selectedId) => set({ selectedId }),
  toggleLayer: (layer) =>
    set((state) => ({
      visibleLayers: {
        ...state.visibleLayers,
        [layer]: !state.visibleLayers[layer],
      },
    })),
  toggleShowOcrText: () => set((state) => ({ showOcrText: !state.showOcrText })),
}));
