"use client";



import { useRouter } from "next/navigation";

import { useForm } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";

import { z } from "zod";

import { WorkspaceShell } from "@/components/shell/WorkspaceShell";

import { projectStore } from "@/lib/mock/store";



const projectSchema = z.object({

  name: z.string().min(1, "Name is required").max(120),

  description: z.string().max(500).optional(),

  jurisdiction: z.string().min(1, "Jurisdiction is required"),

  policyVersion: z.string().min(1, "Policy version is required"),

});



type ProjectFormValues = z.infer<typeof projectSchema>;



export default function NewProjectPage() {

  const router = useRouter();

  const {

    register,

    handleSubmit,

    formState: { errors, isSubmitting },

  } = useForm<ProjectFormValues>({

    resolver: zodResolver(projectSchema),

    defaultValues: {

      jurisdiction: "victoria",

      policyVersion: "draft-v1",

    },

  });



  const onSubmit = handleSubmit((values) => {

    const project = projectStore.createProject(values);

    router.push(`/projects/${project.id}`);

  });



  return (

    <WorkspaceShell>

      <div className="flex h-full min-h-0 flex-col">

        <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">

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

                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"

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

                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"

              />

            </div>



            <div>

              <label htmlFor="jurisdiction" className="mb-1 block text-sm font-medium">

                Jurisdiction

              </label>

              <input

                id="jurisdiction"

                {...register("jurisdiction")}

                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"

              />

              {errors.jurisdiction && (

                <p className="mt-1 text-sm text-red-600">{errors.jurisdiction.message}</p>

              )}

            </div>



            <div>

              <label htmlFor="policyVersion" className="mb-1 block text-sm font-medium">

                Policy version

              </label>

              <input

                id="policyVersion"

                {...register("policyVersion")}

                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"

              />

              {errors.policyVersion && (

                <p className="mt-1 text-sm text-red-600">{errors.policyVersion.message}</p>

              )}

            </div>



            <div className="flex gap-3 pt-2">

              <button type="submit" disabled={isSubmitting} className="btn-primary">

                Create project

              </button>

              <button

                type="button"

                className="btn-secondary"

                onClick={() => router.back()}

              >

                Cancel

              </button>

            </div>

          </form>

        </div>

      </div>

    </WorkspaceShell>

  );

}

