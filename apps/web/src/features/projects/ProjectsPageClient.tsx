"use client";

import Link from "next/link";
import { WorkspaceShell } from "@/components/shell/WorkspaceShell";
import { useProjects } from "@/hooks/useProjectStore";

export function ProjectsPageClient() {
  const { projects, ready } = useProjects();

  return (
    <WorkspaceShell>
      <div className="flex h-full items-center justify-center p-8">
        <div className="hl-block max-w-md px-8 py-7 text-center">
          <h1 className="text-xl font-semibold text-slate-900">HighLife</h1>
          <p className="mt-2 text-sm text-slate-600">
            Select a project in the Project tab, or create one to upload a residential floor plan.
          </p>
          {ready && projects.length === 0 && (
            <Link href="/projects/new" className="btn-primary mt-6 inline-flex">
              Create first project
            </Link>
          )}
        </div>
      </div>
    </WorkspaceShell>
  );
}
