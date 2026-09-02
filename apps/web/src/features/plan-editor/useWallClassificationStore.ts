"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type WallClassifyMode = "hybrid" | "thickness" | "label";

type WallClassificationState = {
  /** Walls at or above this thickness (mm) are treated as external boundaries. */
  externalMinMm: number;
  /** When page scale is missing, walls at or above this thickness (px) are external. */
  externalMinPx: number;
  mode: WallClassifyMode;
  /** Color wall overlays by internal vs external classification. */
  colorByThickness: boolean;
  setExternalMinMm: (mm: number) => void;
  setExternalMinPx: (px: number) => void;
  setMode: (mode: WallClassifyMode) => void;
  setColorByThickness: (on: boolean) => void;
};

export const DEFAULT_EXTERNAL_MIN_MM = 150;
export const DEFAULT_EXTERNAL_MIN_PX = 8;

export const useWallClassificationStore = create<WallClassificationState>()(
  persist(
    (set) => ({
      externalMinMm: DEFAULT_EXTERNAL_MIN_MM,
      externalMinPx: DEFAULT_EXTERNAL_MIN_PX,
      mode: "hybrid",
      colorByThickness: true,
      setExternalMinMm: (externalMinMm) => set({ externalMinMm }),
      setExternalMinPx: (externalMinPx) => set({ externalMinPx }),
      setMode: (mode) => set({ mode }),
      setColorByThickness: (colorByThickness) => set({ colorByThickness }),
    }),
    { name: "highlife_wall_classification" },
  ),
);
