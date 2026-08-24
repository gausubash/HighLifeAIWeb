"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/features/plan-viewer/useLayoutStore";
import { AppMenuBar } from "./AppMenuBar";
import { AppTopBar } from "./AppTopBar";
import { Panel } from "./Panel";
import { ProjectSidebar } from "./ProjectSidebar";

interface WorkspaceShellProps {
  children: ReactNode;
  inspector?: ReactNode;
  inspectorTitle?: string;
  mainClassName?: string;
  showSidebar?: boolean;
  statusText?: string;
}

export function WorkspaceShell({
  children,
  inspector,
  inspectorTitle = "Inspector",
  mainClassName,
  showSidebar = true,
  statusText,
}: WorkspaceShellProps) {
  const router = useRouter();
  const sidebarOpen = useLayoutStore((s) => s.sidebarOpen);
  const inspectorOpen = useLayoutStore((s) => s.inspectorOpen);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const toggleInspector = useLayoutStore((s) => s.toggleInspector);

  // Rehydrate layout prefs after mount (skipHydration)
  useEffect(() => {
    void useLayoutStore.persist.rehydrate();
  }, []);

  // Desktop shortcuts
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
      } else if (key === "n") {
        e.preventDefault();
        router.push("/projects/new");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, toggleSidebar, toggleInspector]);

  const showInspector = Boolean(inspector) && inspectorOpen;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-100">
      <AppMenuBar />
      <AppTopBar />
      <div className="flex min-h-0 flex-1">
        {showSidebar && sidebarOpen && <ProjectSidebar />}
        <main
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
            mainClassName
          )}
        >
          {children}
        </main>
        {showInspector && (
          <aside className="flex w-72 shrink-0 flex-col border-l border-slate-200 bg-white sm:w-80">
            <Panel
              title={inspectorTitle}
              bodyClassName="overflow-y-auto p-3"
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
        )}
      </div>
      <footer className="flex h-6 shrink-0 items-center justify-between border-t border-slate-200 bg-slate-50 px-3 text-[10px] text-slate-500">
        <span className="truncate">{statusText ?? "Ready"}</span>
        <span className="shrink-0 tabular-nums">
          {[
            showSidebar && (sidebarOpen ? "Sidebar" : null),
            inspector ? (inspectorOpen ? "Inspector" : null) : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Panels hidden"}
        </span>
      </footer>
    </div>
  );
}
