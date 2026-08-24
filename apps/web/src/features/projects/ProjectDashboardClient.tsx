"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { WorkspaceShell } from "@/components/shell/WorkspaceShell";
import { ProjectSettingsPanel } from "@/features/projects/ProjectSettingsPanel";
import { useProject } from "@/hooks/useProjectStore";

const UploadDropzone = dynamic(
  () =>
    import("@/features/uploads/UploadDropzone").then((mod) => mod.UploadDropzone),
  { ssr: false, loading: () => <p className="text-sm text-slate-500">Loading uploader…</p> }
);

interface ProjectDashboardClientProps {
  projectId: string;
}

export function ProjectDashboardClient({ projectId }: ProjectDashboardClientProps) {
  const router = useRouter();
  const { project, ready } = useProject(projectId);

  if (ready && !project) {
    return (
      <WorkspaceShell statusText="Project not found">
        <div className="flex h-full items-center justify-center p-8">
          <div className="text-center">
            <p className="text-slate-600">Project not found.</p>
            <Link href="/projects" className="btn-primary mt-4 inline-flex">
              Back to projects
            </Link>
          </div>
        </div>
      </WorkspaceShell>
    );
  }

  if (!project) {
    return (
      <WorkspaceShell statusText="Loading…">
        <div className="flex h-full items-center justify-center text-sm text-slate-500">
          Loading project…
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      statusText={project.name}
      inspectorTitle="Project"
      inspector={
        <ProjectSettingsPanel
          project={project}
          onDeleted={() => router.push("/projects")}
        />
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
          <h1 className="text-lg font-semibold text-slate-900">{project.name}</h1>
          {project.description && (
            <p className="mt-0.5 text-sm text-slate-600">{project.description}</p>
          )}
          <dl className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
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

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-2xl">
            <UploadDropzone
              projectId={projectId}
              onComplete={(analysisId) => {
                router.push(`/projects/${projectId}/analyses/${analysisId}`);
              }}
            />
          </div>
        </div>
      </div>
    </WorkspaceShell>
  );
}
