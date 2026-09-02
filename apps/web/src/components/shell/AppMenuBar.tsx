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
import { projectStore } from "@/lib/data/projectStore";
import {
  INSPECTOR_WIDTH,
  LEFT_PANEL_WIDTH,
  SIDEBAR_WIDTH,
  useLayoutStore,
} from "@/features/plan-viewer/useLayoutStore";
import { useProject } from "@/hooks/useProjectStore";
import { useAuth } from "@/lib/auth/AuthProvider";
import type { StudioTabId } from "@/features/studio/StudioTabBar";
import { useStudioNavStore } from "@/features/studio/useStudioNavStore";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/lib/theme/useThemeStore";

type MenuId = "file" | "project" | "studio" | "view" | "account" | null;

function MenuItem({
  label,
  shortcut,
  disabled,
  danger,
  checked,
  onClick,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[14px]",
        disabled
          ? "cursor-not-allowed text-slate-300"
          : danger
            ? "text-red-700 hover:bg-red-50"
            : "text-slate-700 hover:bg-slate-50"
      )}
    >
      <span className="flex items-center gap-2">
        {checked != null ? (
          <span className="w-3 text-[13px] text-slate-400">{checked ? "✓" : ""}</span>
        ) : null}
        {label}
      </span>
      {shortcut && <span className="text-xs text-slate-400">{shortcut}</span>}
    </button>
  );
}

function MenuDivider() {
  return <div className="my-1 border-t border-slate-200" />;
}

function ThemeSubmenu({
  theme,
  onPick,
}: {
  theme: "light" | "dark";
  onPick: (mode: "light" | "dark") => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[14px] text-slate-700 hover:bg-slate-50"
      >
        <span>Theme</span>
        <span className="text-xs text-slate-400">›</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="hl-island absolute left-full top-0 z-50 ml-0.5 min-w-[140px] py-1"
        >
          <MenuItem label="Light" checked={theme === "light"} onClick={() => onPick("light")} />
          <MenuItem label="Dark" checked={theme === "dark"} onClick={() => onPick("dark")} />
        </div>
      ) : null}
    </div>
  );
}

export function AppMenuBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [openMenu, setOpenMenu] = useState<MenuId>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const sidebarOpen = useLayoutStore((s) => s.sidebarOpen);
  const inspectorOpen = useLayoutStore((s) => s.inspectorOpen);
  const leftPanelOpen = useLayoutStore((s) => s.leftPanelOpen);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const toggleInspector = useLayoutStore((s) => s.toggleInspector);
  const toggleLeftPanel = useLayoutStore((s) => s.toggleLeftPanel);
  const setSidebarOpen = useLayoutStore((s) => s.setSidebarOpen);
  const setInspectorOpen = useLayoutStore((s) => s.setInspectorOpen);
  const setLeftPanelOpen = useLayoutStore((s) => s.setLeftPanelOpen);
  const setSidebarWidth = useLayoutStore((s) => s.setSidebarWidth);
  const setLeftPanelWidth = useLayoutStore((s) => s.setLeftPanelWidth);
  const setInspectorWidth = useLayoutStore((s) => s.setInspectorWidth);

  const projectMatch = pathname.match(/^\/projects\/([^/]+)/);
  const projectId =
    projectMatch && projectMatch[1] !== "new" ? projectMatch[1] : undefined;
  const { project } = useProject(projectId);

  const analysisMatch = pathname.match(/\/analyses\/([^/]+)/);
  const analysisId = analysisMatch?.[1];
  const inStudio = pathname.startsWith("/studio");
  const setStudioTab = useStudioNavStore((s) => s.setTab);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

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
    void projectStore.updateProject(project.id, { name: trimmed });
  };

  const deleteActiveProject = () => {
    if (!project) return;
    if (!window.confirm(`Delete project “${project.name}” and all drawings?`)) return;
    void projectStore.deleteProject(project.id).then(() => router.push("/projects"));
  };

  const deleteActiveDrawing = () => {
    if (!analysisId) return;
    if (!window.confirm("Delete this drawing?")) return;
    void projectStore.deleteAnalysis(analysisId).then(() => {
      if (projectId) router.push(`/projects/${projectId}`);
      else router.push("/projects");
    });
  };

  const menus: {
    id: Exclude<MenuId, null>;
    label: string;
    content: ReactNode;
  }[] = inStudio
    ? [
        {
          id: "file",
          label: "File",
          content: (
            <>
              <MenuItem
                label="Back to projects"
                onClick={() => run(() => router.push("/projects"))}
              />
              <MenuDivider />
              <MenuItem
                label="Model Studio home"
                onClick={() =>
                  run(() => {
                    setStudioTab("datasets");
                    router.push("/studio");
                  })
                }
              />
              <MenuItem
                label="Detection & ML reference"
                onClick={() => run(() => router.push("/docs"))}
              />
            </>
          ),
        },
        {
          id: "studio",
          label: "Studio",
          content: (
            <>
              {(
                [
                  ["datasets", "Datasets"],
                  ["annotate", "Annotate"],
                  ["train", "Train"],
                  ["models", "Models"],
                  ["infer", "Test"],
                ] as Array<[StudioTabId, string]>
              ).map(([id, label]) => (
                <MenuItem
                  key={id}
                  label={label}
                  onClick={() =>
                    run(() => {
                      setStudioTab(id);
                      router.push("/studio");
                    })
                  }
                />
              ))}
            </>
          ),
        },
        {
          id: "view",
          label: "View",
          content: (
            <>
              <MenuItem
                label={sidebarOpen ? "Hide studio panel" : "Show studio panel"}
                shortcut="Ctrl+B"
                onClick={() => run(toggleSidebar)}
              />
              <MenuItem
                label={leftPanelOpen ? "Hide pages panel" : "Show pages panel"}
                onClick={() => run(toggleLeftPanel)}
              />
              <MenuItem
                label={inspectorOpen ? "Hide inspector" : "Show inspector"}
                shortcut="Ctrl+I"
                onClick={() => run(toggleInspector)}
              />
              <MenuDivider />
              <ThemeSubmenu theme={theme} onPick={(mode) => run(() => setTheme(mode))} />
              <MenuItem
                label="Reset layout"
                onClick={() =>
                  run(() => {
                    setSidebarOpen(true);
                    setLeftPanelOpen(true);
                    setInspectorOpen(true);
                    setSidebarWidth(SIDEBAR_WIDTH.default);
                    setLeftPanelWidth(LEFT_PANEL_WIDTH.default);
                    setInspectorWidth(INSPECTOR_WIDTH.default);
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
              <div className="px-3 py-1.5 text-xs text-slate-500">
                {user?.email ?? "Signed in"}
              </div>
              <MenuDivider />
              <MenuItem
                label="Go to website"
                onClick={() => run(() => router.push("/"))}
              />
              <MenuItem
                label="Detection & ML reference"
                onClick={() => run(() => router.push("/docs"))}
              />
              <MenuItem
                label="Sign out"
                onClick={() =>
                  run(() => {
                    void signOut().then(() => router.replace("/"));
                  })
                }
              />
            </>
          ),
        },
      ]
    : [
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
          <MenuItem
            label="Model Studio"
            onClick={() => run(() => router.push("/studio"))}
          />
          <MenuItem
            label="Detection & ML reference"
            onClick={() => run(() => router.push("/docs"))}
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
                  setSidebarOpen(true);
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
            label={sidebarOpen ? "Hide properties panel" : "Show properties panel"}
            shortcut="Ctrl+B"
            onClick={() => run(toggleSidebar)}
          />
          <MenuItem
            label={leftPanelOpen ? "Hide pages panel" : "Show pages panel"}
            onClick={() => run(toggleLeftPanel)}
          />
          <MenuItem
            label={inspectorOpen ? "Hide inspector" : "Show inspector"}
            shortcut="Ctrl+I"
            onClick={() => run(toggleInspector)}
          />
          <MenuDivider />
          <ThemeSubmenu theme={theme} onPick={(mode) => run(() => setTheme(mode))} />
          <MenuItem
            label="Reset layout"
            onClick={() =>
              run(() => {
                setSidebarOpen(true);
                setLeftPanelOpen(true);
                setInspectorOpen(true);
                setSidebarWidth(SIDEBAR_WIDTH.default);
                setLeftPanelWidth(LEFT_PANEL_WIDTH.default);
                setInspectorWidth(INSPECTOR_WIDTH.default);
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
          <div className="px-3 py-1.5 text-xs text-slate-500">
            {user?.email ?? "Signed in"}
          </div>
          <MenuDivider />
          <MenuItem
            label="Go to website"
            onClick={() => run(() => router.push("/"))}
          />
          <MenuItem
            label="Detection & ML reference"
            onClick={() => run(() => router.push("/docs"))}
          />
          <MenuItem
            label="Sign out"
            onClick={() =>
              run(() => {
                void signOut().then(() => router.replace("/"));
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
      className="flex h-8 shrink-0 items-center px-1.5"
      role="menubar"
    >
      <Link
        href={inStudio ? "/studio" : "/projects"}
        className="mr-2 rounded px-2 py-1 font-display text-sm font-semibold text-[var(--hl-ink)] hover:bg-[var(--hl-raised)]"
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
                "rounded px-2.5 py-1 text-[14px] text-[var(--hl-ink)]",
                isOpen ? "bg-[var(--hl-raised)]" : "hover:bg-[var(--hl-raised)]"
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
                className="hl-island absolute left-0 top-full z-50 mt-1 min-w-[220px] py-1"
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
