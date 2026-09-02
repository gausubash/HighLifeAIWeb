import type { MlModel } from "./types";
import { FPR_SPECIALISTS } from "@/lib/fpr/specialistCatalog";

export type StudioBakeBundle = {
  schema: "highlife-fpr-bake/1";
  exportedAt: string;
  model: {
    id: string;
    name: string;
    task: string;
    architecture: string;
    category: string | null;
    class_names: string[];
    metrics: Record<string, unknown> | null;
    storage_path: string;
    detectToken: string;
  };
  specialist: (typeof FPR_SPECIALISTS)[number] | null;
};

export function studioBakeBundle(model: MlModel): StudioBakeBundle {
  const specialist =
    FPR_SPECIALISTS.find((s) => s.studioCategory && s.studioCategory === (model.category ?? "")) ?? null;
  return {
    schema: "highlife-fpr-bake/1",
    exportedAt: new Date().toISOString(),
    model: {
      id: model.id,
      name: model.name,
      task: model.task,
      architecture: model.architecture,
      category: model.category ?? null,
      class_names: model.class_names,
      metrics: model.metrics,
      storage_path: model.storage_path,
      detectToken: `studio:${model.id}`,
    },
    specialist,
  };
}

export function downloadStudioBakeBundle(model: MlModel): void {
  const blob = new Blob([JSON.stringify(studioBakeBundle(model), null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `highlife-bake-${model.id.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
