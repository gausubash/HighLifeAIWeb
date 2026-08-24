"use client";

import Link from "next/link";
import { WorkspaceShell } from "@/components/shell/WorkspaceShell";
import { PlanViewer } from "@/features/plan-viewer/PlanViewer";
import { LayerControls } from "@/features/plan-viewer/LayerControls";
import { UnitSidebar } from "@/features/units/UnitSidebar";
import { ResultsTable } from "@/features/compliance/ResultsTable";
import { useAnalysisBundle } from "@/hooks/useProjectStore";

interface ReviewPageClientProps {
  projectId: string;
  analysisId: string;
}

export function ReviewPageClient({ projectId, analysisId }: ReviewPageClientProps) {
  const { analysis, result, ready } = useAnalysisBundle(analysisId);

  if (ready && (!analysis || !result)) {
    return (
      <WorkspaceShell statusText="Drawing not found">
        <div className="flex h-full items-center justify-center p-8">
          <p className="text-slate-600">Drawing not found.</p>
        </div>
      </WorkspaceShell>
    );
  }

  if (!analysis || !result) {
    return (
      <WorkspaceShell statusText="Loading…">
        <div className="flex h-full items-center justify-center text-sm text-slate-500">
          Loading…
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      statusText={analysis.sourceFileName}
      inspectorTitle="Layers & units"
      inspector={
        <div className="space-y-4">
          <LayerControls result={result} />
          <hr className="border-slate-200" />
          <UnitSidebar result={result} />
        </div>
      }
    >
      <div className="flex h-full min-h-0 flex-col bg-white">
        <div className="shrink-0 border-b border-slate-200 px-3 py-2">
          <Link
            href={`/projects/${projectId}/analyses/${analysisId}`}
            className="text-xs text-brand-600 hover:underline"
          >
            ← Back to drawing
          </Link>
          <p className="mt-1 text-sm font-medium text-slate-800">{analysis.sourceFileName}</p>
        </div>

        <div className="min-h-0 flex-1">
          <PlanViewer result={result} />
        </div>

        <div className="h-44 shrink-0 overflow-y-auto border-t border-slate-200 bg-white p-3">
          <ResultsTable result={result} />
        </div>
      </div>
    </WorkspaceShell>
  );
}
