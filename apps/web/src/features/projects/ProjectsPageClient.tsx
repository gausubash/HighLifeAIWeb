"use client";

import Link from "next/link";
import { useMemo } from "react";
import { WorkspaceShell } from "@/components/shell/WorkspaceShell";
import { useProjects } from "@/hooks/useProjectStore";
import { cn, formatDate } from "@/lib/utils";

export function ProjectsPageClient() {
  const { projects, ready } = useProjects();

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [projects],
  );

  return (
    <WorkspaceShell>
      <div className="flex h-full flex-col overflow-y-auto p-6 md:p-8">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Projects</h1>
              <p className="mt-1 text-sm text-slate-600">
                Open a saved project or create a new one for residential floor-plan analysis.
              </p>
            </div>
            <Link href="/projects/new" className="btn-primary shrink-0">
              New project
            </Link>
          </div>

          {!ready ? (
            <p className="text-sm text-slate-500">Loading projects…</p>
          ) : sortedProjects.length === 0 ? (
            <div className="hl-block px-6 py-8 text-center">
              <p className="text-sm text-slate-600">No projects yet.</p>
              <Link href="/projects/new" className="btn-primary mt-4 inline-flex">
                Create first project
              </Link>
            </div>
          ) : (
            <ul className="space-y-2">
              {sortedProjects.map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/projects/${project.id}`}
                    className={cn(
                      "hl-block flex items-center justify-between gap-4 px-4 py-3 transition-colors",
                      "hover:border-brand-200 hover:bg-brand-50/40",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{project.name}</p>
                      {project.description ? (
                        <p className="mt-0.5 truncate text-xs text-slate-500">{project.description}</p>
                      ) : (
                        <p className="mt-0.5 text-xs text-slate-500">{project.jurisdiction}</p>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">{formatDate(project.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </WorkspaceShell>
  );
}
