"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { UploadDropzone } from "@/features/uploads/UploadDropzone";
import { StatusBadge } from "@/components/StatusBadge";
import { mockStore } from "@/lib/mock/store";
import { formatDate } from "@/lib/utils";

interface ProjectDashboardClientProps {
  projectId: string;
}

function subscribe(cb: () => void) {
  window.addEventListener("mock-store-change", cb);
  return () => window.removeEventListener("mock-store-change", cb);
}

export function ProjectDashboardClient({ projectId }: ProjectDashboardClientProps) {
  const router = useRouter();
  const project = useSyncExternalStore(
    subscribe,
    () => mockStore.getProject(projectId),
    () => mockStore.getProject(projectId)
  );
  const analyses = useSyncExternalStore(
    subscribe,
    () => mockStore.listAnalyses(projectId),
    () => mockStore.listAnalyses(projectId)
  );

  if (!project) {
    return (
      <div className="card text-center">
        <p className="text-slate-600">Project not found.</p>
        <Link href="/projects" className="btn-primary mt-4 inline-flex">
          Back to projects
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <Link href="/projects" className="text-sm text-brand-600 hover:underline">
          ← Projects
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{project.name}</h1>
        {project.description && (
          <p className="mt-1 text-slate-600">{project.description}</p>
        )}
        <dl className="mt-3 flex flex-wrap gap-4 text-sm text-slate-500">
          <div>
            <dt className="inline font-medium">Jurisdiction: </dt>
            <dd className="inline capitalize">{project.jurisdiction}</dd>
          </div>
          <div>
            <dt className="inline font-medium">Policy: </dt>
            <dd className="inline">{project.policyVersion}</dd>
          </div>
        </dl>
      </div>

      <UploadDropzone
        projectId={projectId}
        onComplete={(analysisId) => {
          window.dispatchEvent(new Event("mock-store-change"));
          router.push(`/projects/${projectId}/analyses/${analysisId}`);
        }}
      />

      <div>
        <h2 className="mb-4 text-lg font-semibold">Analysis history</h2>
        {analyses.length === 0 ? (
          <p className="text-sm text-slate-500">No analyses yet.</p>
        ) : (
          <ul className="space-y-3">
            {analyses.map((analysis) => (
              <li key={analysis.id}>
                <Link
                  href={`/projects/${projectId}/analyses/${analysis.id}`}
                  className="card flex flex-wrap items-center justify-between gap-3 transition hover:border-brand-300"
                >
                  <div>
                    <p className="font-medium">{analysis.sourceFileName}</p>
                    <p className="text-xs text-slate-500">
                      {formatDate(analysis.createdAt)}
                      {analysis.unitCount != null && ` · ${analysis.unitCount} units`}
                      {analysis.reviewCount != null && analysis.reviewCount > 0 &&
                        ` · ${analysis.reviewCount} review items`}
                    </p>
                  </div>
                  <StatusBadge status={analysis.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
