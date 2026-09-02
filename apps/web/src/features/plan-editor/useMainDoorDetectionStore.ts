"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { MainDoorWidthMode, MainDoorWidthOpts } from "@/lib/hierarchy/communalMainDoor";
import { DEFAULT_MAIN_DOOR_MIN_SPAN_PX } from "@/lib/hierarchy/communalMainDoor";

type MainDoorDetectionState = {
  mode: MainDoorWidthMode;
  /** Minimum detected opening span (px) treated as a unit main door in threshold mode. */
  minSpanPx: number;
  /** Highlight classified main doors on the plan overlay. */
  highlightOnDrawing: boolean;
  setMode: (mode: MainDoorWidthMode) => void;
  setMinSpanPx: (px: number) => void;
  setHighlightOnDrawing: (on: boolean) => void;
};

export const useMainDoorDetectionStore = create<MainDoorDetectionState>()(
  persist(
    (set) => ({
      mode: "threshold",
      minSpanPx: DEFAULT_MAIN_DOOR_MIN_SPAN_PX,
      highlightOnDrawing: true,
      setMode: (mode) => set({ mode }),
      setMinSpanPx: (minSpanPx) => set({ minSpanPx }),
      setHighlightOnDrawing: (highlightOnDrawing) => set({ highlightOnDrawing }),
    }),
    { name: "highlife_main_door_detection" },
  ),
);

export function mainDoorWidthOptsFromStore(): MainDoorWidthOpts {
  const { mode, minSpanPx } = useMainDoorDetectionStore.getState();
  return { mode, minSpanPx };
}
