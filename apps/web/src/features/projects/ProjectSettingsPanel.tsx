"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Project } from "@highlife/shared-types";
import { projectStore } from "@/lib/mock/store";

interface ProjectSettingsPanelProps {
  project: Project;
  onUpdated?: (project: Project) => void;
  onDeleted?: () => void;
}

export function ProjectSettingsPanel({
  project,
  onUpdated,
  onDeleted,
}: ProjectSettingsPanelProps) {
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [jurisdiction, setJurisdiction] = useState(project.jurisdiction);
  const [policyVersion, setPolicyVersion] = useState(project.policyVersion);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(project.name);
    setDescription(project.description ?? "");
    setJurisdiction(project.jurisdiction);
    setPolicyVersion(project.policyVersion);
    setError(null);
    setConfirmDelete(false);
  }, [project]);

  const handleSave = () => {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Project name is required.");
      return;
    }

    const updated = projectStore.updateProject(project.id, {
      name: trimmedName,
      description: description.trim() || undefined,
      jurisdiction: jurisdiction.trim(),
      policyVersion: policyVersion.trim(),
    });

    if (updated) onUpdated?.(updated);
  };

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    projectStore.deleteProject(project.id);
    onDeleted?.();
    router.push("/projects");
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="project-name" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Name
        </label>
        <input
          id="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      <div>
        <label htmlFor="project-description" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Description
        </label>
        <textarea
          id="project-description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      <div>
        <label htmlFor="project-jurisdiction" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Jurisdiction
        </label>
        <input
          id="project-jurisdiction"
          value={jurisdiction}
          onChange={(e) => setJurisdiction(e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      <div>
        <label htmlFor="project-policy" className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Policy version
        </label>
        <input
          id="project-policy"
          value={policyVersion}
          onChange={(e) => setPolicyVersion(e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button type="button" className="btn-primary flex-1 text-xs" onClick={handleSave}>
          Save changes
        </button>
      </div>

      <hr className="border-slate-200" />

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Danger zone
        </p>
        {confirmDelete ? (
          <div className="space-y-2 rounded border border-red-200 bg-red-50 p-3">
            <p className="text-xs text-red-800">
              Delete this project and all uploaded drawings? This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary flex-1 text-xs" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="flex-1 rounded border border-red-600 bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                onClick={handleDelete}
              >
                Delete project
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="w-full rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
            onClick={handleDelete}
          >
            Delete project…
          </button>
        )}
      </div>
    </div>
  );
}
