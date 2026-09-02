"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { WorkspaceShell } from "@/components/shell/WorkspaceShell";
import { projectStore } from "@/lib/data/projectStore";

const projectSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  description: z.string().max(500).optional(),
  jurisdiction: z.string().min(1, "Jurisdiction is required"),
  policyVersion: z.string().min(1, "Policy version is required"),
});

type ProjectFormValues = z.infer<typeof projectSchema>;

export default function NewProjectPage() {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      jurisdiction: "victoria",
      policyVersion: "hooper_apartment_rules_v1",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const project = await projectStore.createProject(values);
      router.push(`/projects/${project.id}`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Could not create project.");
    }
  });

  return (
    <WorkspaceShell>
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-[var(--hl-line)] px-4 py-3">
          <h1 className="text-lg font-semibold">Create project</h1>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <form onSubmit={onSubmit} className="card mx-auto max-w-lg space-y-4">
            <div>
              <label htmlFor="name" className="mb-1 block text-sm font-medium">
                Name
              </label>
              <input
                id="name"
                {...register("name")}
                className="hl-input"
              />
              {errors.name && (
                <p className="mt-1 text-sm text-red-600">{errors.name.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="description" className="mb-1 block text-sm font-medium">
                Description
              </label>
              <textarea
                id="description"
                rows={3}
                {...register("description")}
                className="hl-input"
              />
            </div>

            <div>
              <label htmlFor="jurisdiction" className="mb-1 block text-sm font-medium">
                Jurisdiction
              </label>
              <input
                id="jurisdiction"
                {...register("jurisdiction")}
                className="hl-input"
              />
              {errors.jurisdiction && (
                <p className="mt-1 text-sm text-red-600">{errors.jurisdiction.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="policyVersion" className="mb-1 block text-sm font-medium">
                Policy version
              </label>
              <select
                id="policyVersion"
                {...register("policyVersion")}
                className="hl-input"
              >
                <option value="hooper_apartment_rules_v1">
                  hooper_apartment_rules_v1 — Apartment design rules (Hooper 2022)
                </option>
              </select>
              {errors.policyVersion && (
                <p className="mt-1 text-sm text-red-600">{errors.policyVersion.message}</p>
              )}
            </div>

            {submitError && <p className="text-sm text-red-600">{submitError}</p>}

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={isSubmitting} className="btn-primary">
                {isSubmitting ? "Creating…" : "Create project"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => router.back()}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </WorkspaceShell>
  );
}
