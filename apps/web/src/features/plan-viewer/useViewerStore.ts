"use client";

import { create } from "zustand";
import type { ViewerLayer } from "@highlife/shared-types";
import { clampOcrOverlayFontSize, OCR_OVERLAY_FONT_DEFAULT } from "./ocrOverlayFont";
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
  /** Show the page raster. Off = overlays only. */
  showPageImage: boolean;
  /** Page raster opacity when visible (0–1). */
  pageImageOpacity: number;
  /** OCR overlay label size in page pixels. */
  ocrFontSize: number;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  setPageIndex: (index: number) => void;
  resetView: () => void;
  selectObject: (id: string | null) => void;
  toggleLayer: (layer: ViewerLayer) => void;
  toggleShowOcrText: () => void;
  toggleShowPageImage: () => void;
  setPageImageOpacity: (opacity: number) => void;
  setOcrFontSize: (size: number) => void;
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
  showPageImage: true,
  pageImageOpacity: 1,
  ocrFontSize: OCR_OVERLAY_FONT_DEFAULT,
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
  toggleShowPageImage: () => set((state) => ({ showPageImage: !state.showPageImage })),
  setPageImageOpacity: (opacity) =>
    set({ pageImageOpacity: Math.min(1, Math.max(0, Number.isFinite(opacity) ? opacity : 1)) }),
  setOcrFontSize: (size) => set({ ocrFontSize: clampOcrOverlayFontSize(size) }),
}));
