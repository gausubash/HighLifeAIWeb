"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface LayoutState {
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  projectsSectionOpen: boolean;
  drawingsSectionOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  setInspectorOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  toggleInspector: () => void;
  toggleProjectsSection: () => void;
  toggleDrawingsSection: () => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      inspectorOpen: true,
      projectsSectionOpen: true,
      drawingsSectionOpen: true,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setInspectorOpen: (open) => set({ inspectorOpen: open }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
      toggleProjectsSection: () =>
        set((s) => ({ projectsSectionOpen: !s.projectsSectionOpen })),
      toggleDrawingsSection: () =>
        set((s) => ({ drawingsSectionOpen: !s.drawingsSectionOpen })),
    }),
    {
      name: "highlife-layout",
      // Avoid SSR/localStorage mismatch: only rehydrate after mount
      skipHydration: true,
    }
  )
);
