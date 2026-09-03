"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
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
import { VerticalInspectorTabs } from "./VerticalInspectorTabs";

const ACTIVITY_BAR_WIDTH = 44;
const PROJECT_TAB = { id: "project", label: "Project", title: "Projects and drawings" };
const PAGE_TAB_ID = "page";

function PropertiesPanel({ onClose }: { onClose?: () => void }) {
  return (
    <Panel
      title="Properties"
      bodyClassName="overflow-y-auto p-3"
      action={onClose ? <PanelCloseButton onClick={onClose} title="Hide properties panel" /> : undefined}
    >
      <p className="text-xs leading-relaxed text-slate-500">
        Select an item on the drawing to inspect its properties.
      </p>
    </Panel>
  );
}

function PanelCloseButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      className="rounded p-1 text-slate-500 hover:bg-[var(--hl-raised)] hover:text-slate-800"
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M9 6l6 6-6 6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function FloatingMainChrome({
  toolbar,
  pinned,
}: {
  toolbar?: ReactNode;
  pinned: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const hideTimer = useRef<number | null>(null);

  const clearHide = () => {
    if (hideTimer.current != null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  };

  const enter = () => {
    clearHide();
    setHovered(true);
  };

  const leave = () => {
    clearHide();
    hideTimer.current = window.setTimeout(() => {
      setHovered(false);
      hideTimer.current = null;
    }, 180);
  };

  useEffect(() => () => clearHide(), []);

  const userToolbarPinned = useLayoutStore((s) => s.toolbarPinned);

  if (!toolbar) return null;

  const toolsVisible = pinned || userToolbarPinned || hovered || focused;

  return (
    <>
      <div
        className="absolute inset-x-0 top-0 z-20 h-8"
        onMouseEnter={enter}
        onMouseLeave={leave}
        aria-hidden
      />
      <div
        className="absolute inset-x-0 top-0 z-30 flex flex-col gap-px px-2"
        onMouseEnter={enter}
        onMouseLeave={leave}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setFocused(false);
          }
        }}
      >
        {toolbar && toolsVisible ? (
          <div className="hl-group overflow-hidden rounded-md border border-slate-200/80 bg-white/95 shadow-md backdrop-blur-sm">
            {toolbar}
          </div>
        ) : null}
      </div>
    </>
  );
}

interface WorkspaceShellProps {
  children: ReactNode;
  inspector?: ReactNode;
  inspectorTitle?: string;
  inspectorHint?: ReactNode;
  /** Keep a VS Code-style icon rail when the inspector panel is closed. */
  inspectorHasRail?: boolean;
  /** Secondary panel to the left of main content (e.g. page list). */
  leftPanel?: ReactNode;
  leftPanelTitle?: string;
  leftPanelHint?: ReactNode;
  /** Right-hand properties panel. Defaults to an empty Properties placeholder. */
  sidebar?: ReactNode;
  /** Left Project tab content. Defaults to the project / drawing browser. */
  projectPanel?: ReactNode;
  mainClassName?: string;
  showSidebar?: boolean;
  statusText?: string;
  hideTopBar?: boolean;
  /** Drawing tools; floats over the main panel on hover or when pinned. */
  toolbar?: ReactNode;
  /** Keep the floating toolbar visible (active tool, busy work). */
  toolbarPinned?: boolean;
  /** When false, Ctrl/Cmd+N does not open New project. */
  allowNewProjectShortcut?: boolean;
  /** Icon-only left rail (e.g. Model Studio). Replaces the project inspector. */
  activityRail?: ReactNode;
}

export function WorkspaceShell({
  children,
  inspector,
  inspectorTitle = "Inspector",
  inspectorHint,
  inspectorHasRail = false,
  leftPanel,
  leftPanelTitle = "Pages",
  leftPanelHint,
  sidebar,
  projectPanel,
  mainClassName,
  showSidebar = true,
  statusText,
  hideTopBar: _hideTopBar = false,
  toolbar,
  toolbarPinned = false,
  allowNewProjectShortcut = true,
  activityRail,
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

  const [shellTab, setShellTab] = useState("project");
  const projectContent = projectPanel ?? <ProjectSidebar />;
  const shellTabs = [
    PROJECT_TAB,
    ...(inspector ? [{ id: PAGE_TAB_ID, label: inspectorTitle, title: inspectorTitle }] : []),
  ];
  const shellInspector = (
    <VerticalInspectorTabs tabs={shellTabs} activeId={shellTab} onChange={setShellTab}>
      {shellTab === "project" ? projectContent : inspector}
    </VerticalInspectorTabs>
  );
  const inspectorNode = inspectorHasRail ? inspector : shellInspector;
  const hasInspectorContent = Boolean(inspector);
  const showInspector = inspectorOpen && hasInspectorContent;
  // Project explorer lives in the same left chrome as the activity rail. Do not
  // keep that column at 44px just because this page has no analysis inspector.
  const showLeftExplorer = Boolean(inspectorOpen && inspectorNode && !activityRail);
  const showLeftPanel = Boolean(leftPanel) && leftPanelOpen;
  const effectiveShowSidebar = showSidebar && !activityRail;

  const inspectorPanel = hasInspectorContent ? (
    activityRail ? (
      <Panel
        title={inspectorTitle}
        hint={inspectorHint}
        bodyClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-0"
        action={
          <PanelCloseButton onClick={toggleInspector} title={`Hide ${inspectorTitle}`} />
        }
      >
        {inspector}
      </Panel>
    ) : (
      inspectorNode
    )
  ) : null;

  const collapsedInspectorToggleRight = hasInspectorContent && !inspectorOpen ? (
    <button
      type="button"
      title={`Show ${inspectorTitle}`}
      onClick={toggleInspector}
      className="hl-group flex w-7 shrink-0 items-center justify-center text-slate-500 hover:bg-[var(--hl-raised)]"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
        <path
          d="M6.8 1.6 3.2 5l3.6 3.4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  ) : null;

  const rightInspectorPanel =
    activityRail && hasInspectorContent ? (
      showInspector ? (
        <>
          <PanelResizeHandle
            edge="left"
            value={inspectorWidth}
            onChange={setInspectorWidth}
            min={INSPECTOR_WIDTH.min}
            max={INSPECTOR_WIDTH.max}
          />
          <aside
            className="hl-group flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden"
            style={{ width: inspectorWidth }}
          >
            {inspectorPanel}
          </aside>
        </>
      ) : (
        collapsedInspectorToggleRight
      )
    ) : null;

  return (
    <div className="hl-workbench flex h-full max-h-full min-h-0 flex-col overflow-hidden">
      <div className="hl-chrome shrink-0">
        <AppMenuBar />
      </div>
      <div className="hl-chrome hl-workbench-columns hl-workbench-body">
        {activityRail ? (
          <aside
            className="flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden"
            style={{ width: ACTIVITY_BAR_WIDTH }}
          >
            {activityRail}
          </aside>
        ) : (
          <>
            <aside
              className="flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden"
              style={{
                width: showLeftExplorer ? inspectorWidth : ACTIVITY_BAR_WIDTH,
              }}
            >
              {inspectorNode}
            </aside>
            {showLeftExplorer ? (
              <PanelResizeHandle
                edge="right"
                value={inspectorWidth}
                onChange={setInspectorWidth}
                min={INSPECTOR_WIDTH.min}
                max={INSPECTOR_WIDTH.max}
              />
            ) : null}
          </>
        )}

        {showLeftPanel ? (
          <>
            <aside
              className="hl-group flex h-full min-h-0 shrink-0 flex-col overflow-hidden"
              style={{ width: leftPanelWidth }}
            >
              <Panel
                title={leftPanelTitle}
                hint={leftPanelHint}
                bodyClassName="overflow-y-auto p-2"
                action={
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-xs text-slate-500 hover:bg-[var(--hl-raised)] hover:text-slate-800"
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
            className="hl-group flex w-7 shrink-0 items-center justify-center text-slate-500 hover:bg-[var(--hl-raised)]"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
              <path d="M3.2 1.6 6.8 5 3.2 8.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}

        <div className="hl-panel-stack min-h-0 min-w-0 flex-1 overflow-hidden">
          <main
            className={cn(
              "hl-group relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
              mainClassName,
            )}
          >
            <FloatingMainChrome toolbar={toolbar} pinned={toolbarPinned} />
            {children}
          </main>
          <footer className="hl-group flex h-9 shrink-0 items-center gap-3 px-3 text-xs text-slate-600">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              <AppTopBar />
            </div>
            <span className="min-w-0 shrink-0 truncate text-right text-slate-500">
              {statusText ?? "Ready"}
            </span>
          </footer>
        </div>

        {rightInspectorPanel}

        {effectiveShowSidebar && sidebarOpen ? (
          <>
            <PanelResizeHandle
              edge="left"
              value={sidebarWidth}
              onChange={setSidebarWidth}
              min={SIDEBAR_WIDTH.min}
              max={SIDEBAR_WIDTH.max}
            />
            <div
              className="flex h-full max-h-full min-h-0 shrink-0 flex-col overflow-hidden"
              style={{ width: sidebarWidth }}
            >
              {sidebar ? (
                sidebar
              ) : (
                <div className="hl-group flex min-h-0 flex-1 flex-col overflow-hidden">
                  <PropertiesPanel onClose={toggleSidebar} />
                </div>
              )}
            </div>
          </>
        ) : effectiveShowSidebar ? (
          <button
            type="button"
            title="Show properties panel"
            onClick={toggleSidebar}
            className="hl-group flex w-7 shrink-0 items-center justify-center text-slate-500 hover:bg-[var(--hl-raised)]"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
              <path
                d="M6.8 1.6 3.2 5l3.6 3.4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
}
