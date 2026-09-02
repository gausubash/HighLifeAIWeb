"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HoverHint } from "@/components/ui/HoverHint";
import { FloorPlanTree } from "@/features/plan-viewer/PageThumbnailStrip";
import { useAnalyses, useProjects } from "@/hooks/useProjectStore";
import { projectStore } from "@/lib/data/projectStore";
import type { AnalysisStatus, PlanPage, Project } from "@highlife/shared-types";
import { cn, formatDate } from "@/lib/utils";

const STATUS_DOT: Record<AnalysisStatus, string> = {
  queued: "bg-slate-300",
  processing: "bg-blue-500 animate-pulse",
  review_required: "bg-amber-400",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  cancelled: "bg-slate-300",
};

const STATUS_LABEL: Record<AnalysisStatus, string> = {
  queued: "Queued",
  processing: "Processing",
  review_required: "Review required",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

function drawingLabel(name: string) {
  let base = name.replace(/\.(pdf|png|jpe?g|webp)$/i, "");
  base = base.replace(/_page_\d+$/i, "");
  if (base.length > 40) return `${base.slice(0, 37)}…`;
  return base || name.replace(/\.pdf$/i, "");
}

function TreeChevron({ open }: { open: boolean }) {
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[12px] text-slate-400">
      {open ? "▾" : "▸"}
    </span>
  );
}

function ProjectIcon({ active }: { active?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      className={cn("shrink-0", active ? "text-brand-600" : "text-amber-500/90")}
      aria-hidden
    >
      <path
        d="M4 7.5A1.5 1.5 0 0 1 5.5 6h3.2l1.4 1.6H18.5A1.5 1.5 0 0 1 20 9.1v8.4A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-10Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.12 : 0}
      />
    </svg>
  );
}

function DrawingIcon({ active }: { active?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      className={cn("shrink-0", active ? "text-brand-600" : "text-slate-400")}
      aria-hidden
    >
      <path
        d="M7 3.5h7.2L20 9.3V20a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1-1.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M14 3.5V9h6" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path
        d="M8.5 13.5h7M8.5 16h4.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity={0.7}
      />
    </svg>
  );
}

function FloorPlansIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="shrink-0 text-slate-400" aria-hidden>
      <rect x="5" y="4" width="14" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 9h8M8 12h6M8 15h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function TreeGuide({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("relative ml-3 border-l border-[var(--hl-line)] pl-2", className)}>{children}</div>
  );
}

function CountBadge({ count, label }: { count: number; label: string }) {
  return (
    <span
      className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[12px] tabular-nums text-slate-500"
      title={label}
    >
      {count}
    </span>
  );
}

type ProjectSidebarProps = {
  /** Floor plans for the active drawing — nested under that drawing in the tree. */
  pages?: PlanPage[];
  activePageIndex?: number;
  onSelectPage?: (index: number) => void;
  onDeletePage?: (page: PlanPage) => void;
  deletingPageNumber?: number | null;
  pageDeleteError?: ReactNode;
  /** Append PDF pages or images as new floor sheets in the active drawing. */
  onAddPages?: (files: FileList) => void;
  addingPages?: boolean;
  addPagesError?: ReactNode;
};

export function ProjectSidebar({
  pages = [],
  activePageIndex = 0,
  onSelectPage,
  onDeletePage,
  deletingPageNumber = null,
  pageDeleteError,
  onAddPages,
  addingPages = false,
  addPagesError,
}: ProjectSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const addPagesInputRef = useRef<HTMLInputElement>(null);
  const { projects, ready } = useProjects();
  const [menuProjectId, setMenuProjectId] = useState<string | null>(null);
  const [menuDrawingId, setMenuDrawingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [expandedDrawings, setExpandedDrawings] = useState<Record<string, boolean>>({});
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const projectMatch = pathname.match(/^\/projects\/([^/]+)/);
  const activeProjectId =
    projectMatch && projectMatch[1] !== "new" ? projectMatch[1] : undefined;
  const { analyses } = useAnalyses(activeProjectId);
  const activeAnalysisId = pathname.match(/\/analyses\/([^/]+)/)?.[1];

  useEffect(() => {
    if (!renamingProjectId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingProjectId]);

  useEffect(() => {
    if (activeProjectId) {
      setExpandedProjects((prev) => ({ ...prev, [activeProjectId]: true }));
    }
  }, [activeProjectId]);

  useEffect(() => {
    if (activeAnalysisId) {
      setExpandedDrawings((prev) => ({ ...prev, [activeAnalysisId]: true }));
    }
  }, [activeAnalysisId]);

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

  const handleDeleteProject = async (projectId: string) => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await projectStore.deleteProject(projectId);
    closeMenus();
    if (activeProjectId === projectId) router.push("/projects");
  };

  const handleDeleteDrawing = async (drawingId: string) => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await projectStore.deleteAnalysis(drawingId);
    closeMenus();
    if (activeAnalysisId === drawingId && activeProjectId) {
      router.push(`/projects/${activeProjectId}`);
    }
  };

  const cancelRenameProject = () => {
    setRenamingProjectId(null);
    setRenameDraft("");
  };

  const startRenameProject = (project: Project) => {
    closeMenus();
    setRenamingProjectId(project.id);
    setRenameDraft(project.name);
  };

  const commitRenameProject = async (project: Project) => {
    const trimmed = renameDraft.trim();
    if (!trimmed || trimmed === project.name) {
      cancelRenameProject();
      return;
    }
    await projectStore.updateProject(project.id, { name: trimmed });
    cancelRenameProject();
  };

  const isProjectExpanded = (projectId: string) => expandedProjects[projectId] ?? projectId === activeProjectId;
  const isDrawingExpanded = (drawingId: string) =>
    expandedDrawings[drawingId] ?? drawingId === activeAnalysisId;

  const sortedProjects = useMemo(
    () =>
      [...projects].sort((a, b) => {
        if (a.id === activeProjectId) return -1;
        if (b.id === activeProjectId) return 1;
        return b.updatedAt.localeCompare(a.updatedAt);
      }),
    [activeProjectId, projects],
  );

  return (
    <aside className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-[var(--hl-panel)]">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--hl-line)] px-2 py-2">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-slate-400">Explorer</p>
        <Link
          href="/projects/new"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-50 hover:text-slate-700"
          title="New project"
        >
          +
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {!ready ? (
          <p className="px-2 py-1.5 text-xs text-slate-400">Loading…</p>
        ) : sortedProjects.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-slate-400">No projects yet</p>
        ) : (
          <ul className="space-y-0.5 px-1">
            {sortedProjects.map((project) => {
              const isActiveProject = activeProjectId === project.id;
              const projectOpen = isProjectExpanded(project.id);
              const menuOpen = menuProjectId === project.id;
              const projectDrawings = isActiveProject ? analyses : [];

              return (
                <li key={project.id} className="relative" data-sidebar-menu={menuOpen ? project.id : undefined}>
                  <div
                    className={cn(
                      "group flex items-center rounded-md transition-colors",
                      isActiveProject ? "bg-brand-50/80" : "hover:bg-slate-50",
                    )}
                  >
                    <button
                      type="button"
                      aria-label={projectOpen ? "Collapse project" : "Expand project"}
                      className="flex h-7 w-5 shrink-0 items-center justify-center rounded hover:bg-white/70"
                      onClick={() =>
                        setExpandedProjects((prev) => ({
                          ...prev,
                          [project.id]: !projectOpen,
                        }))
                      }
                    >
                      <TreeChevron open={projectOpen} />
                    </button>
                    {renamingProjectId === project.id ? (
                      <div className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 pr-1">
                        <ProjectIcon active={isActiveProject} />
                        <input
                          ref={renameInputRef}
                          aria-label="Rename project"
                          className="min-w-0 flex-1 rounded border border-[var(--hl-stroke)] bg-[var(--hl-panel)] px-1.5 py-0.5 text-[14px] text-[var(--hl-ink)] outline-none ring-1 ring-[var(--hl-accent)]/40"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onBlur={() => void commitRenameProject(project)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void commitRenameProject(project);
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              cancelRenameProject();
                            }
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    ) : (
                      <Link
                        href={`/projects/${project.id}`}
                        title={`${project.name}\nUpdated ${formatDate(project.updatedAt)}\nDouble-click to rename`}
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 text-[14px]",
                          isActiveProject ? "font-medium text-brand-800" : "text-slate-700",
                        )}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          startRenameProject(project);
                        }}
                      >
                        <ProjectIcon active={isActiveProject} />
                        <span className="truncate">{project.name}</span>
                      </Link>
                    )}
                    {isActiveProject && projectDrawings.length > 0 ? (
                      <CountBadge count={projectDrawings.length} label="Drawings in project" />
                    ) : null}
                    <button
                      type="button"
                      aria-label={`Project menu: ${project.name}`}
                      className="mr-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 hover:bg-white hover:text-slate-700 group-hover:opacity-100"
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

                  {menuOpen ? (
                    <div className="hl-island absolute right-2 top-8 z-20 w-32 py-1">
                      <button
                        type="button"
                        className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                        onClick={() => startRenameProject(project)}
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
                  ) : null}

                  {projectOpen && isActiveProject ? (
                    <TreeGuide>
                      {projectDrawings.length === 0 ? (
                        <p className="py-1 text-xs text-slate-400">No drawings</p>
                      ) : (
                        <ul className="space-y-0.5">
                          {projectDrawings.map((analysis) => {
                            const isActiveDrawing = activeAnalysisId === analysis.id;
                            const drawingOpen = isDrawingExpanded(analysis.id);
                            const drawingMenuOpen = menuDrawingId === analysis.id;
                            const label = drawingLabel(analysis.sourceFileName);
                            const floorCount =
                              isActiveDrawing && pages.length > 0
                                ? pages.length
                                : analysis.pageCount ?? 0;

                            return (
                              <li
                                key={analysis.id}
                                className="relative"
                                data-sidebar-menu={drawingMenuOpen ? analysis.id : undefined}
                              >
                                <div
                                  className={cn(
                                    "group flex items-center rounded-md transition-colors",
                                    isActiveDrawing ? "bg-brand-50" : "hover:bg-slate-50",
                                  )}
                                >
                                  <button
                                    type="button"
                                    aria-label={drawingOpen ? "Collapse drawing" : "Expand drawing"}
                                    className="flex h-7 w-5 shrink-0 items-center justify-center rounded hover:bg-white/70"
                                    onClick={() =>
                                      setExpandedDrawings((prev) => ({
                                        ...prev,
                                        [analysis.id]: !drawingOpen,
                                      }))
                                    }
                                  >
                                    <TreeChevron open={drawingOpen} />
                                  </button>
                                  <Link
                                    href={`/projects/${project.id}/analyses/${analysis.id}`}
                                    title={`${analysis.sourceFileName}\n${STATUS_LABEL[analysis.status]} · ${formatDate(analysis.createdAt)}`}
                                    className={cn(
                                      "flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 text-[14px]",
                                      isActiveDrawing ? "font-medium text-brand-800" : "text-slate-700",
                                    )}
                                  >
                                    <DrawingIcon active={isActiveDrawing} />
                                    <span className="truncate">{label}</span>
                                    <span
                                      className={cn(
                                        "ml-auto h-1.5 w-1.5 shrink-0 rounded-full",
                                        STATUS_DOT[analysis.status],
                                      )}
                                      title={STATUS_LABEL[analysis.status]}
                                    />
                                  </Link>
                                  {floorCount > 0 ? (
                                    <CountBadge count={floorCount} label="Floor plans in drawing" />
                                  ) : null}
                                  <button
                                    type="button"
                                    aria-label={`Drawing menu: ${analysis.sourceFileName}`}
                                    className="mr-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-slate-400 opacity-0 hover:bg-white hover:text-slate-700 group-hover:opacity-100"
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

                                {drawingMenuOpen ? (
                                  <div className="hl-island absolute right-2 top-8 z-20 w-32 py-1">
                                    <Link
                                      href={`/projects/${project.id}/analyses/${analysis.id}`}
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
                                ) : null}

                                {drawingOpen && isActiveDrawing && onSelectPage ? (
                                  <TreeGuide className="mt-0.5">
                                    <div className="flex items-center gap-1.5 py-1">
                                      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-slate-400">
                                        <FloorPlansIcon />
                                        <span>Floor plans</span>
                                        <HoverHint
                                          label="About floor plans"
                                          text="One PDF can hold many floors (one sheet per page). You can also add single-page images — one file, one floor."
                                        />
                                        {pages.length > 0 ? (
                                          <span className="font-normal normal-case text-slate-300">
                                            {activePageIndex + 1} / {pages.length}
                                          </span>
                                        ) : null}
                                      </div>
                                      {onAddPages ? (
                                        <>
                                          <input
                                            ref={addPagesInputRef}
                                            type="file"
                                            accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp"
                                            multiple
                                            className="hidden"
                                            onChange={(e) => {
                                              if (e.target.files?.length) onAddPages(e.target.files);
                                              e.target.value = "";
                                            }}
                                          />
                                          <button
                                            type="button"
                                            className="shrink-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                                            disabled={addingPages}
                                            title="Add PDF pages or floor plan images to this drawing"
                                            onClick={() => addPagesInputRef.current?.click()}
                                          >
                                            {addingPages ? "Adding…" : "Add pages"}
                                          </button>
                                        </>
                                      ) : null}
                                    </div>
                                    <FloorPlanTree
                                      analysisId={analysis.id}
                                      pages={pages}
                                      activeIndex={activePageIndex}
                                      onSelect={onSelectPage}
                                      onDeletePage={onDeletePage}
                                      deletingPageNumber={deletingPageNumber}
                                    />
                                    {pageDeleteError ? (
                                      <p className="pb-1 text-xs leading-relaxed text-red-600">
                                        {pageDeleteError}
                                      </p>
                                    ) : null}
                                    {addPagesError ? (
                                      <p className="pb-1 text-xs leading-relaxed text-red-600">
                                        {addPagesError}
                                      </p>
                                    ) : null}
                                  </TreeGuide>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </TreeGuide>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--hl-line)] px-2">
        <Link
          href="/studio"
          title="Model Studio"
          className="flex h-9 items-center gap-1.5 rounded px-1.5 text-[14px] text-slate-500 hover:bg-slate-50 hover:text-slate-800"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
            <rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6" />
            <rect x="13" y="4" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6" />
            <rect x="4" y="13" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6" />
            <rect x="13" y="13" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          <span>Studio</span>
        </Link>
      </div>
    </aside>
  );
}
