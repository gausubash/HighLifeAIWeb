"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { mockStore } from "@/lib/mock/store";
import { formatDate } from "@/lib/utils";

function subscribe(cb: () => void) {
  window.addEventListener("mock-store-change", cb);
  return () => window.removeEventListener("mock-store-change", cb);
}

function getSnapshot() {
  return mockStore.listProjects();
}

export function ProjectsPageClient() {
  const projects = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Projects</h1>
          <p className="mt-1 text-sm text-slate-600">
            Urban planning assessments and building reviews
          </p>
        </div>
        <Link href="/projects/new" className="btn-primary">
          New project
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="card text-center text-slate-500">
          No projects yet. Create one to get started.
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/projects/${project.id}`}
                className="card block transition hover:border-brand-300 hover:shadow-md"
              >
                <h2 className="font-semibold text-slate-900">{project.name}</h2>
                {project.description && (
                  <p className="mt-1 text-sm text-slate-600 line-clamp-2">
                    {project.description}
                  </p>
                )}
                <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <div>
                    <dt className="inline">Jurisdiction: </dt>
                    <dd className="inline capitalize">{project.jurisdiction}</dd>
                  </div>
                  <div>
                    <dt className="inline">Policy: </dt>
                    <dd className="inline">{project.policyVersion}</dd>
                  </div>
                  <div>
                    <dt className="inline">Updated: </dt>
                    <dd className="inline">{formatDate(project.updatedAt)}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
