"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Project } from "@highlife/shared-types";
import { projectStore } from "@/lib/data/projectStore";

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

  const handleSave = async () => {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Project name is required.");
      return;
    }

    try {
      const updated = await projectStore.updateProject(project.id, {
        name: trimmedName,
        description: description.trim() || undefined,
        jurisdiction: jurisdiction.trim(),
        policyVersion: policyVersion.trim(),
      });
      if (updated) onUpdated?.(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save project.");
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    try {
      await projectStore.deleteProject(project.id);
      onDeleted?.();
      router.push("/projects");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete project.");
    }
  };

  return (
    <div className="space-y-4 overflow-y-auto p-4">
      <div>
        <label htmlFor="project-name" className="hl-label">
          Name
        </label>
        <input
          id="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="hl-input"
        />
      </div>

      <div>
        <label htmlFor="project-description" className="hl-label">
          Description
        </label>
        <textarea
          id="project-description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="hl-input"
        />
      </div>

      <div>
        <label htmlFor="project-jurisdiction" className="hl-label">
          Jurisdiction
        </label>
        <input
          id="project-jurisdiction"
          value={jurisdiction}
          onChange={(e) => setJurisdiction(e.target.value)}
          className="hl-input"
        />
      </div>

      <div>
        <label htmlFor="project-policy" className="hl-label">
          Policy version
        </label>
        <select
          id="project-policy"
          value={policyVersion}
          onChange={(e) => setPolicyVersion(e.target.value)}
          className="hl-input"
        >
          <option value="hooper_apartment_rules_v1">
            hooper_apartment_rules_v1 — Apartment design rules (Hooper 2022)
          </option>
          {policyVersion && policyVersion !== "hooper_apartment_rules_v1" ? (
            <option value={policyVersion}>{policyVersion} (current)</option>
          ) : null}
        </select>
        <p className="mt-1 text-xs text-slate-500">
          Used by Detect → Run policy check (configs/policies/version.yaml).
        </p>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button type="button" className="btn-primary flex-1 text-xs" onClick={handleSave}>
          Save changes
        </button>
      </div>

      <hr className="border-slate-200" />

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
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
