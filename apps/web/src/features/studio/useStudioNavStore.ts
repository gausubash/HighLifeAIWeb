"use client";

import { create } from "zustand";
import type { StudioTabId } from "./StudioTabBar";

interface StudioNavState {
  tab: StudioTabId;
  setTab: (tab: StudioTabId) => void;
}

export const useStudioNavStore = create<StudioNavState>((set) => ({
  tab: "datasets",
  setTab: (tab) => set({ tab }),
}));
