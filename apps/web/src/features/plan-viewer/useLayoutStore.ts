"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

interface LayoutState {
  sidebarOpen: boolean;
  inspectorOpen: boolean;
  leftPanelOpen: boolean;
  projectsSectionOpen: boolean;
  drawingsSectionOpen: boolean;
  pagesSectionOpen: boolean;
  sidebarWidth: number;
  leftPanelWidth: number;
  inspectorWidth: number;
  setSidebarOpen: (open: boolean) => void;
  setInspectorOpen: (open: boolean) => void;
  setLeftPanelOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  toggleInspector: () => void;
  toggleLeftPanel: () => void;
  toggleProjectsSection: () => void;
  toggleDrawingsSection: () => void;
  togglePagesSection: () => void;
  setSidebarWidth: (width: number) => void;
  setLeftPanelWidth: (width: number) => void;
  setInspectorWidth: (width: number) => void;
}

export const SIDEBAR_WIDTH = { min: 160, max: 360, default: 240 };
export const LEFT_PANEL_WIDTH = { min: 88, max: 260, default: 112 };
export const INSPECTOR_WIDTH = { min: 220, max: 480, default: 288 };

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      inspectorOpen: true,
      leftPanelOpen: true,
      projectsSectionOpen: true,
      drawingsSectionOpen: true,
      pagesSectionOpen: true,
      sidebarWidth: SIDEBAR_WIDTH.default,
      leftPanelWidth: LEFT_PANEL_WIDTH.default,
      inspectorWidth: INSPECTOR_WIDTH.default,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setInspectorOpen: (open) => set({ inspectorOpen: open }),
      setLeftPanelOpen: (open) => set({ leftPanelOpen: open }),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
      toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
      toggleProjectsSection: () =>
        set((s) => ({ projectsSectionOpen: !s.projectsSectionOpen })),
      toggleDrawingsSection: () =>
        set((s) => ({ drawingsSectionOpen: !s.drawingsSectionOpen })),
      togglePagesSection: () => set((s) => ({ pagesSectionOpen: !s.pagesSectionOpen })),
      setSidebarWidth: (width) =>
        set({ sidebarWidth: clamp(width, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max) }),
      setLeftPanelWidth: (width) =>
        set({ leftPanelWidth: clamp(width, LEFT_PANEL_WIDTH.min, LEFT_PANEL_WIDTH.max) }),
      setInspectorWidth: (width) =>
        set({ inspectorWidth: clamp(width, INSPECTOR_WIDTH.min, INSPECTOR_WIDTH.max) }),
    }),
    {
      name: "highlife-layout",
      skipHydration: true,
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        inspectorOpen: state.inspectorOpen,
        leftPanelOpen: state.leftPanelOpen,
        projectsSectionOpen: state.projectsSectionOpen,
        drawingsSectionOpen: state.drawingsSectionOpen,
        pagesSectionOpen: state.pagesSectionOpen,
        sidebarWidth: state.sidebarWidth,
        leftPanelWidth: state.leftPanelWidth,
        inspectorWidth: state.inspectorWidth,
      }),
    },
  ),
);
