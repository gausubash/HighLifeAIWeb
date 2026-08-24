"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/StatusBadge";
import { useLayoutStore } from "@/features/plan-viewer/useLayoutStore";
import { useAnalyses, useProjects } from "@/hooks/useProjectStore";
import { projectStore } from "@/lib/mock/store";
import type { Project } from "@highlife/shared-types";
import { cn, formatDate } from "@/lib/utils";

function SectionHeader({
  title,
  open,
  onToggle,
  action,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 px-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-100"
      >
        <span className="w-3 text-center text-slate-400">{open ? "▾" : "▸"}</span>
        <span className="truncate">{title}</span>
      </button>
      {action}
    </div>
  );
}

export function ProjectSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { projects, ready } = useProjects();
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null);
  const [menuDrawingId, setMenuDrawingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const projectsSectionOpen = useLayoutStore((s) => s.projectsSectionOpen);
  const drawingsSectionOpen = useLayoutStore((s) => s.drawingsSectionOpen);
  const toggleProjectsSection = useLayoutStore((s) => s.toggleProjectsSection);
  const toggleDrawingsSection = useLayoutStore((s) => s.toggleDrawingsSection);

  const projectMatch = pathname.match(/^\/projects\/([^/]+)/);
  const activeProjectId =
    projectMatch && projectMatch[1] !== "new" ? projectMatch[1] : undefined;
  const { analyses } = useAnalyses(activeProjectId);
  const activeAnalysisId = pathname.match(/\/analyses\/([^/]+)/)?.[1];

  useEffect(() => {
    if (!menuProjectId && !menuDrawingId) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (menuProjectId && target.closest(`[data-sidebar-menu="${menuProjectId}"]`)) {
        return;
      }
      if (menuDrawingId && target.closest(`[data-sidebar-menu="${menuDrawingId}"]`)) {
        return;
      }
      setMenuProjectId(null);
      setMenuDrawingId(null);
      setConfirmDelete(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuProjectId, menuDrawingId]);

  const closeMenus = () => {
    setMenuProjectId(null);
    setMenuDrawingId(null);
    setConfirmDelete(false);
  };

  const handleDeleteProject = (projectId: string) => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    projectStore.deleteProject(projectId);
    closeMenus();
    if (activeProjectId === projectId) router.push("/projects");
  };

  const handleDeleteDrawing = (drawingId: string) => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    projectStore.deleteAnalysis(drawingId);
    closeMenus();
    if (activeAnalysisId === drawingId && activeProjectId) {
      router.push(`/projects/${activeProjectId}`);
    }
  };

  const handleRenameProject = (project: Project) => {
    const nextName = window.prompt("Rename project", project.name);
    if (!nextName) return;
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === project.name) return;
    projectStore.updateProject(project.id, { name: trimmed });
    closeMenus();
  };

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        <SectionHeader
          title="Projects"
          open={projectsSectionOpen}
          onToggle={toggleProjectsSection}
          action={
            <Link
              href="/projects/new"
              className="mr-1 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-50"
              title="New project"
            >
              +
            </Link>
          }
        />

        {projectsSectionOpen && (
          <div className="px-1 pb-2">
            {!ready ? (
              <p className="px-2 py-2 text-xs text-slate-400">Loading…</p>
            ) : projects.length === 0 ? (
              <p className="px-2 py-2 text-xs text-slate-500">No projects yet.</p>
            ) : (
              <ul className="space-y-0.5">
                {projects.map((project) => {
                  const isActive = activeProjectId === project.id;
                  const menuOpen = menuProjectId === project.id;
                  return (
                    <li
                      key={project.id}
                      className="relative"
                      data-sidebar-menu={menuOpen ? project.id : undefined}
                    >
                      <div
                        className={cn(
                          "flex items-start rounded-md transition-colors",
                          isActive ? "bg-brand-50" : "hover:bg-slate-50"
                        )}
                      >
                        <Link
                          href={`/projects/${project.id}`}
                          className={cn(
                            "min-w-0 flex-1 px-2 py-1.5 text-sm",
                            isActive ? "font-medium text-brand-800" : "text-slate-700"
                          )}
                        >
                          <span className="line-clamp-2">{project.name}</span>
                          <span className="mt-0.5 block text-[10px] text-slate-400">
                            {formatDate(project.updatedAt)}
                          </span>
                        </Link>
                        <button
                          type="button"
                          aria-label={`Project menu: ${project.name}`}
                          className="mr-1 mt-1.5 shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-white hover:text-slate-700"
                          onClick={() => {
                            if (menuOpen) {
                              closeMenus();
                              return;
                            }
                            setMenuDrawingId(null);
                            setConfirmDelete(false);
                            setMenuProjectId(project.id);
                          }}
                        >
                          ⋯
                        </button>
                      </div>

                      {menuOpen && (
                        <div className="absolute right-2 top-9 z-20 w-36 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                          <button
                            type="button"
                            className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                            onClick={() => handleRenameProject(project)}
                          >
                            Rename
                          </button>
                          <Link
                            href={`/projects/${project.id}`}
                            className="block px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                            onClick={closeMenus}
                          >
                            Open
                          </Link>
                          <button
                            type="button"
                            className="block w-full px-3 py-1.5 text-left text-xs text-red-700 hover:bg-red-50"
                            onClick={() => handleDeleteProject(project.id)}
                          >
                            {confirmDelete ? "Confirm delete" : "Delete"}
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {activeProjectId && (
          <>
            <SectionHeader
              title="Drawings"
              open={drawingsSectionOpen}
              onToggle={toggleDrawingsSection}
            />
            {drawingsSectionOpen && (
              <div className="px-1 pb-2">
                {analyses.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-slate-500">No PDFs uploaded yet.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {analyses.map((analysis) => {
                      const isActive = activeAnalysisId === analysis.id;
                      const drawingMenuOpen = menuDrawingId === analysis.id;
                      return (
                        <li
                          key={analysis.id}
                          className="relative"
                          data-sidebar-menu={drawingMenuOpen ? analysis.id : undefined}
                        >
                          <div
                            className={cn(
                              "flex items-start rounded-md transition-colors",
                              isActive ? "bg-brand-50" : "hover:bg-slate-50"
                            )}
                          >
                            <Link
                              href={`/projects/${activeProjectId}/analyses/${analysis.id}`}
                              className={cn(
                                "min-w-0 flex-1 px-2 py-1.5 text-xs",
                                isActive ? "text-brand-800" : "text-slate-700"
                              )}
                            >
                              <span className="line-clamp-2 font-medium">
                                {analysis.sourceFileName}
                              </span>
                              <span className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
                                <StatusBadge status={analysis.status} />
                                {formatDate(analysis.createdAt)}
                              </span>
                            </Link>
                            <button
                              type="button"
                              aria-label={`Drawing menu: ${analysis.sourceFileName}`}
                              className="mr-1 mt-1.5 shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-white hover:text-slate-700"
                              onClick={() => {
                                if (drawingMenuOpen) {
                                  closeMenus();
                                  return;
                                }
                                setMenuProjectId(null);
                                setConfirmDelete(false);
                                setMenuDrawingId(analysis.id);
                              }}
                            >
                              ⋯
                            </button>
                          </div>
                          {drawingMenuOpen && (
                            <div className="absolute right-2 top-9 z-20 w-36 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                              <Link
                                href={`/projects/${activeProjectId}/analyses/${analysis.id}`}
                                className="block px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                                onClick={closeMenus}
                              >
                                Open
                              </Link>
                              <button
                                type="button"
                                className="block w-full px-3 py-1.5 text-left text-xs text-red-700 hover:bg-red-50"
                                onClick={() => handleDeleteDrawing(analysis.id)}
                              >
                                {confirmDelete ? "Confirm delete" : "Delete"}
                              </button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
