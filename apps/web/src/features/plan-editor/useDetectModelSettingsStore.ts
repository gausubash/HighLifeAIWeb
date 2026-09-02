"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  MITUNET_WALL_DEFAULTS,
  pickMitunetWallSettings,
  type MitunetWallSettings,
} from "./useMitunetWallSettingsStore";
import type { NorthCropScope } from "./northCropScope";

export type DetectFamily = "walls" | "rooms" | "openings" | "objects" | "north" | "structural";

export type DetectPatchSettings = MitunetWallSettings;

const FAMILY_DEFAULTS: Record<DetectFamily, DetectPatchSettings> = {
  walls: { ...MITUNET_WALL_DEFAULTS },
  rooms: { tileEnabled: true, imgsz: 640, threshold: 0.25, overlap: 0.2 },
  openings: { tileEnabled: true, imgsz: 640, threshold: 0.25, overlap: 0.3 },
  structural: { tileEnabled: true, imgsz: 640, threshold: 0.25, overlap: 0.3 },
  objects: { tileEnabled: true, imgsz: 640, threshold: 0.25, overlap: 0.3 },
  north: { tileEnabled: true, imgsz: 640, threshold: 0.25, overlap: 0.3 },
};

type DetectModelSettingsState = {
  families: Record<DetectFamily, DetectPatchSettings>;
  northCrop: NorthCropScope;
  setTileEnabled: (family: DetectFamily, value: boolean) => void;
  setImgsz: (family: DetectFamily, value: number) => void;
  setThreshold: (family: DetectFamily, value: number) => void;
  setOverlap: (family: DetectFamily, value: number) => void;
  setNorthCrop: (value: NorthCropScope) => void;
  resetDefaults: (family: DetectFamily) => void;
  getSettings: (family: DetectFamily) => DetectPatchSettings;
};

function parseNorthCrop(raw: unknown): NorthCropScope {
  if (raw === "drawing" || raw === "page" || raw === "title") return raw;
  return "title";
}

function clampFamily(family: DetectFamily, raw: Partial<DetectPatchSettings> | undefined): DetectPatchSettings {
  return pickMitunetWallSettings({ ...FAMILY_DEFAULTS[family], ...raw });
}

export const DETECT_IMGSZ_OPTIONS: { value: number; label: string }[] = [
  { value: 256, label: "256" },
  { value: 384, label: "384" },
  { value: 512, label: "512" },
  { value: 640, label: "640" },
  { value: 768, label: "768" },
  { value: 1024, label: "1024" },
];

export function familyFromDetectTask(task: string): DetectFamily {
  if (task === "rooms") return "rooms";
  if (task === "openings") return "openings";
  if (task === "structural") return "structural";
  if (task === "objects") return "objects";
  if (task === "north") return "north";
  return "walls";
}

export const useDetectModelSettingsStore = create<DetectModelSettingsState>()(
  persist(
    (set, get) => ({
      families: { ...FAMILY_DEFAULTS },
      northCrop: "title",
      setTileEnabled: (family, tileEnabled) =>
        set((s) => ({ families: { ...s.families, [family]: { ...clampFamily(family, s.families[family]), tileEnabled } } })),
      setImgsz: (family, imgsz) =>
        set((s) => ({
          families: { ...s.families, [family]: clampFamily(family, { ...s.families[family], imgsz }) },
        })),
      setThreshold: (family, threshold) =>
        set((s) => ({
          families: { ...s.families, [family]: clampFamily(family, { ...s.families[family], threshold }) },
        })),
      setOverlap: (family, overlap) =>
        set((s) => ({
          families: { ...s.families, [family]: clampFamily(family, { ...s.families[family], overlap }) },
        })),
      setNorthCrop: (northCrop) => set({ northCrop: parseNorthCrop(northCrop) }),
      resetDefaults: (family) =>
        set((s) => ({ families: { ...s.families, [family]: { ...FAMILY_DEFAULTS[family] } } })),
      getSettings: (family) => clampFamily(family, get().families[family]),
    }),
    {
      name: "highlife_detect_family_settings",
      merge: (persisted, current) => {
        const raw = persisted as
          | { families?: Partial<Record<DetectFamily, DetectPatchSettings>>; northCrop?: unknown }
          | undefined;
        return {
          ...current,
          northCrop: parseNorthCrop(raw?.northCrop),
          families: {
            walls: clampFamily("walls", raw?.families?.walls),
            rooms: clampFamily("rooms", raw?.families?.rooms),
            openings: clampFamily("openings", raw?.families?.openings),
            structural: clampFamily("structural", raw?.families?.structural),
            objects: clampFamily("objects", raw?.families?.objects),
            north: clampFamily("north", raw?.families?.north),
          },
        };
      },
    },
  ),
);
