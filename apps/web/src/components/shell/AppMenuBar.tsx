"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { projectStore } from "@/lib/mock/store";
import { useLayoutStore } from "@/features/plan-viewer/useLayoutStore";
import { useProject } from "@/hooks/useProjectStore";
import { useAuth } from "@/lib/auth/AuthProvider";
import { cn } from "@/lib/utils";

type MenuId = "file" | "project" | "view" | "account" | null;

function MenuItem({
  label,
  shortcut,
  disabled,
  danger,
  onClick,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-xs",
        disabled
          ? "cursor-not-allowed text-slate-300"
          : danger
            ? "text-red-700 hover:bg-red-50"
            : "text-slate-700 hover:bg-slate-100"
      )}
    >
      <span>{label}</span>
      {shortcut && <span className="text-[10px] text-slate-400">{shortcut}</span>}
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 border-t border-slate-200" />;
}

export function AppMenuBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [openMenu, setOpenMenu] = useState<MenuId>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const sidebarOpen = useLayoutStore((s) => s.sidebarOpen);
  const inspectorOpen = useLayoutStore((s) => s.inspectorOpen);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const toggleInspector = useLayoutStore((s) => s.toggleInspector);
  const setSidebarOpen = useLayoutStore((s) => s.setSidebarOpen);
  const setInspectorOpen = useLayoutStore((s) => s.setInspectorOpen);

  const projectMatch = pathname.match(/^\/projects\/([^/]+)/);
  const projectId =
    projectMatch && projectMatch[1] !== "new" ? projectMatch[1] : undefined;
  const { project } = useProject(projectId);

  const analysisMatch = pathname.match(/\/analyses\/([^/]+)/);
  const analysisId = analysisMatch?.[1];

  const close = useCallback(() => setOpenMenu(null), []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [close]);

  const run = (fn: () => void) => {
    fn();
    close();
  };

  const renameActiveProject = () => {
    if (!project) return;
    const next = window.prompt("Rename project", project.name);
    if (!next) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === project.name) return;
    projectStore.updateProject(project.id, { name: trimmed });
  };

  const deleteActiveProject = () => {
    if (!project) return;
    if (!window.confirm(`Delete project “${project.name}” and all drawings?`)) return;
    projectStore.deleteProject(project.id);
    router.push("/projects");
  };

  const deleteActiveDrawing = () => {
    if (!analysisId) return;
    if (!window.confirm("Delete this drawing?")) return;
    projectStore.deleteAnalysis(analysisId);
    if (projectId) router.push(`/projects/${projectId}`);
    else router.push("/projects");
  };

  const menus: {
    id: Exclude<MenuId, null>;
    label: string;
    content: ReactNode;
  }[] = [
    {
      id: "file",
      label: "File",
      content: (
        <>
          <MenuItem
            label="New project…"
            shortcut="Ctrl+N"
            onClick={() => run(() => router.push("/projects/new"))}
          />
          <MenuItem
            label="Open projects"
            onClick={() => run(() => router.push("/projects"))}
          />
          <MenuDivider />
          <MenuItem
            label="Upload PDF…"
            disabled={!projectId}
            onClick={() =>
              run(() => {
                if (projectId) router.push(`/projects/${projectId}`);
              })
            }
          />
        </>
      ),
    },
    {
      id: "project",
      label: "Project",
      content: (
        <>
          <MenuItem
            label="Rename…"
            disabled={!project}
            onClick={() => run(renameActiveProject)}
          />
          <MenuItem
            label="Project settings"
            disabled={!projectId}
            onClick={() =>
              run(() => {
                if (projectId) {
                  setInspectorOpen(true);
                  router.push(`/projects/${projectId}`);
                }
              })
            }
          />
          <MenuDivider />
          <MenuItem
            label="Delete drawing…"
            disabled={!analysisId}
            danger
            onClick={() => run(deleteActiveDrawing)}
          />
          <MenuItem
            label="Delete project…"
            disabled={!project}
            danger
            onClick={() => run(deleteActiveProject)}
          />
        </>
      ),
    },
    {
      id: "view",
      label: "View",
      content: (
        <>
          <MenuItem
            label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            shortcut="Ctrl+B"
            onClick={() => run(toggleSidebar)}
          />
          <MenuItem
            label={inspectorOpen ? "Hide inspector" : "Show inspector"}
            shortcut="Ctrl+I"
            onClick={() => run(toggleInspector)}
          />
          <MenuDivider />
          <MenuItem
            label="Reset layout"
            onClick={() =>
              run(() => {
                setSidebarOpen(true);
                setInspectorOpen(true);
              })
            }
          />
        </>
      ),
    },
    {
      id: "account",
      label: "Account",
      content: (
        <>
          <div className="px-3 py-1.5 text-[10px] text-slate-400">
            {user?.email ?? "Signed in"}
          </div>
          <MenuDivider />
          <MenuItem
            label="Go to website"
            onClick={() => run(() => router.push("/"))}
          />
          <MenuItem
            label="Sign out"
            onClick={() =>
              run(() => {
                signOut();
                router.replace("/");
              })
            }
          />
        </>
      ),
    },
  ];

  return (
    <div
      ref={barRef}
      className="flex h-7 shrink-0 items-center border-b border-slate-200 bg-slate-50 px-1"
      role="menubar"
    >
      <Link
        href="/projects"
        className="mr-2 px-2 font-display text-xs font-semibold text-brand-700 hover:text-brand-800"
      >
        HighLife
      </Link>

      {menus.map((menu) => {
        const isOpen = openMenu === menu.id;
        return (
          <div key={menu.id} className="relative">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="true"
              aria-expanded={isOpen}
              className={cn(
                "rounded px-2.5 py-1 text-xs text-slate-700",
                isOpen ? "bg-slate-200" : "hover:bg-slate-200/70"
              )}
              onClick={() => setOpenMenu(isOpen ? null : menu.id)}
              onMouseEnter={() => {
                if (openMenu) setOpenMenu(menu.id);
              }}
            >
              {menu.label}
            </button>
            {isOpen && (
              <div
                role="menu"
                className="absolute left-0 top-full z-50 mt-0.5 min-w-[200px] rounded border border-slate-200 bg-white py-1 shadow-lg"
              >
                {menu.content}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
