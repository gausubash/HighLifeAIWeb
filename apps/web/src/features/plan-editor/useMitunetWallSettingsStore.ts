"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type MitunetWallSettings = {
  tileEnabled: boolean;
  imgsz: number;
  threshold: number;
  overlap: number;
};

export const MITUNET_WALL_DEFAULTS: MitunetWallSettings = {
  tileEnabled: true,
  imgsz: 512,
  threshold: 0.5,
  overlap: 0.2,
};

export const MITUNET_IMGSZ_OPTIONS: { value: number; label: string }[] = [
  { value: 256, label: "256" },
  { value: 384, label: "384" },
  { value: 512, label: "512" },
  { value: 640, label: "640" },
  { value: 768, label: "768" },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type MitunetWallSettingsState = MitunetWallSettings & {
  setTileEnabled: (value: boolean) => void;
  setImgsz: (value: number) => void;
  setThreshold: (value: number) => void;
  setOverlap: (value: number) => void;
  resetDefaults: () => void;
  getSettings: () => MitunetWallSettings;
};

export function pickMitunetWallSettings(state: MitunetWallSettings): MitunetWallSettings {
  return {
    tileEnabled: Boolean(state.tileEnabled),
    imgsz: clamp(Number(state.imgsz) || 512, 256, 1024),
    threshold: clamp(Number(state.threshold) || 0.5, 0.05, 0.95),
    overlap: clamp(Number(state.overlap) || 0, 0, 0.5),
  };
}

export const useMitunetWallSettingsStore = create<MitunetWallSettingsState>()(
  persist(
    (set, get) => ({
      ...MITUNET_WALL_DEFAULTS,
      setTileEnabled: (tileEnabled) => set({ tileEnabled }),
      setImgsz: (imgsz) => set({ imgsz: clamp(imgsz, 256, 1024) }),
      setThreshold: (threshold) => set({ threshold: clamp(threshold, 0.05, 0.95) }),
      setOverlap: (overlap) => set({ overlap: clamp(overlap, 0, 0.5) }),
      resetDefaults: () => set({ ...MITUNET_WALL_DEFAULTS }),
      getSettings: () => pickMitunetWallSettings(get()),
    }),
    { name: "highlife_mitunet_wall_settings" },
  ),
);
