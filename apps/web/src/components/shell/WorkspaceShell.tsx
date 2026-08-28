"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  INSPECTOR_WIDTH,
  LEFT_PANEL_WIDTH,
  SIDEBAR_WIDTH,
  useLayoutStore,
} from "@/features/plan-viewer/useLayoutStore";
import { AppMenuBar } from "./AppMenuBar";
import { AppTopBar } from "./AppTopBar";
import { Panel } from "./Panel";
import { PanelResizeHandle } from "./PanelResizeHandle";
import { ProjectSidebar } from "./ProjectSidebar";

interface WorkspaceShellProps {
  children: ReactNode;
  inspector?: ReactNode;
  inspectorTitle?: string;
  /** Secondary panel to the left of main content (e.g. page list). */
  leftPanel?: ReactNode;
  leftPanelTitle?: string;
  /** Replace the default project sidebar (e.g. Model Studio nav). */
  sidebar?: ReactNode;
  mainClassName?: string;
  showSidebar?: boolean;
  statusText?: string;
  footerLeading?: ReactNode;
  hideTopBar?: boolean;
  /** When false, Ctrl/Cmd+N does not open New project. */
  allowNewProjectShortcut?: boolean;
}

export function WorkspaceShell({
  children,
  inspector,
  inspectorTitle = "Inspector",
  leftPanel,
  leftPanelTitle = "Pages",
  sidebar,
  mainClassName,
  showSidebar = true,
  statusText,
  footerLeading,
  hideTopBar = false,
  allowNewProjectShortcut = true,
}: WorkspaceShellProps) {
  const router = useRouter();
  const sidebarOpen = useLayoutStore((s) => s.sidebarOpen);
  const inspectorOpen = useLayoutStore((s) => s.inspectorOpen);
  const leftPanelOpen = useLayoutStore((s) => s.leftPanelOpen);
  const sidebarWidth = useLayoutStore((s) => s.sidebarWidth);
  const leftPanelWidth = useLayoutStore((s) => s.leftPanelWidth);
  const inspectorWidth = useLayoutStore((s) => s.inspectorWidth);
  const setSidebarWidth = useLayoutStore((s) => s.setSidebarWidth);
  const setLeftPanelWidth = useLayoutStore((s) => s.setLeftPanelWidth);
  const setInspectorWidth = useLayoutStore((s) => s.setInspectorWidth);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const toggleInspector = useLayoutStore((s) => s.toggleInspector);
  const toggleLeftPanel = useLayoutStore((s) => s.toggleLeftPanel);

  useEffect(() => {
    void useLayoutStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "b") {
        e.preventDefault();
        toggleSidebar();
      } else if (key === "i") {
        e.preventDefault();
        toggleInspector();
      } else if (key === "n" && allowNewProjectShortcut) {
        e.preventDefault();
        router.push("/projects/new");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [allowNewProjectShortcut, router, toggleSidebar, toggleInspector]);

  const showInspector = Boolean(inspector) && inspectorOpen;
  const showLeftPanel = Boolean(leftPanel) && leftPanelOpen;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-100">
      <AppMenuBar />
      {!hideTopBar ? <AppTopBar /> : null}
      <div className="flex min-h-0 flex-1">
        {showSidebar && sidebarOpen ? (
          <>
            <div className="flex h-full shrink-0 flex-col" style={{ width: sidebarWidth }}>
              {sidebar ?? <ProjectSidebar />}
            </div>
            <PanelResizeHandle
              edge="right"
              value={sidebarWidth}
              onChange={setSidebarWidth}
              min={SIDEBAR_WIDTH.min}
              max={SIDEBAR_WIDTH.max}
            />
          </>
        ) : null}

        {showLeftPanel ? (
          <>
            <aside
              className="flex h-full shrink-0 flex-col border-r border-slate-200 bg-white"
              style={{ width: leftPanelWidth }}
            >
              <Panel
                title={leftPanelTitle}
                bodyClassName="overflow-y-auto p-1.5"
                action={
                  <button
                    type="button"
                    className="text-[10px] text-slate-500 hover:text-slate-800"
                    onClick={toggleLeftPanel}
                    title="Hide pages panel"
                  >
                    Hide
                  </button>
                }
              >
                {leftPanel}
              </Panel>
            </aside>
            <PanelResizeHandle
              edge="right"
              value={leftPanelWidth}
              onChange={setLeftPanelWidth}
              min={LEFT_PANEL_WIDTH.min}
              max={LEFT_PANEL_WIDTH.max}
            />
          </>
        ) : leftPanel && !leftPanelOpen ? (
          <button
            type="button"
            title={`Show ${leftPanelTitle}`}
            onClick={toggleLeftPanel}
            className="flex w-5 shrink-0 items-center justify-center border-r border-slate-200 bg-slate-50 text-[10px] text-slate-500 hover:bg-slate-100"
          >
            ▸
          </button>
        ) : null}

        <main
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
            mainClassName,
          )}
        >
          {children}
        </main>

        {showInspector ? (
          <>
            <PanelResizeHandle
              edge="left"
              value={inspectorWidth}
              onChange={setInspectorWidth}
              min={INSPECTOR_WIDTH.min}
              max={INSPECTOR_WIDTH.max}
            />
            <aside
              className="flex h-full shrink-0 flex-col border-l border-slate-200 bg-white"
              style={{ width: inspectorWidth }}
            >
              <Panel
                title={inspectorTitle}
                bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
                action={
                  <button
                    type="button"
                    className="text-[10px] text-slate-500 hover:text-slate-800"
                    onClick={toggleInspector}
                    title="Hide inspector"
                  >
                    Hide
                  </button>
                }
              >
                {inspector}
              </Panel>
            </aside>
          </>
        ) : null}
      </div>
      <footer
        className={cn(
          "flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-2 text-[10px] text-slate-500",
          footerLeading ? "h-8" : "h-6 px-3",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {footerLeading}
          <span className="truncate">{statusText ?? "Ready"}</span>
        </div>
        <span className="shrink-0 tabular-nums">
          {[
            showSidebar && (sidebarOpen ? "Sidebar" : null),
            showLeftPanel ? leftPanelTitle : null,
            inspector ? (inspectorOpen ? "Inspector" : null) : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Panels hidden"}
        </span>
      </footer>
    </div>
  );
}
