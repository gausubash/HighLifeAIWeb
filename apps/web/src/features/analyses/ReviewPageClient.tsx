"use client";

import Link from "next/link";
import { useState } from "react";
import { WorkspaceShell } from "@/components/shell/WorkspaceShell";
import { PlanViewer } from "@/features/plan-viewer/PlanViewer";
import { LayerControls } from "@/features/plan-viewer/LayerControls";
import { UnitSidebar } from "@/features/units/UnitSidebar";
import { ResultsTable } from "@/features/compliance/ResultsTable";
import { useAnalysisBundle } from "@/hooks/useProjectStore";
import { useViewerStore } from "@/features/plan-viewer/useViewerStore";
import { exportAnalysisJson, exportComplianceCsv } from "@/lib/export/analysisExport";

interface ReviewPageClientProps {
  projectId: string;
  analysisId: string;
}

export function ReviewPageClient({ projectId, analysisId }: ReviewPageClientProps) {
  const { analysis, result, ready } = useAnalysisBundle(analysisId);
  const selectObject = useViewerStore((s) => s.selectObject);
  const selectedId = useViewerStore((s) => s.selectedId);
  const [exportNote, setExportNote] = useState<string | null>(null);

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
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
          <div>
            <Link
              href={`/projects/${projectId}/analyses/${analysisId}`}
              className="text-xs text-brand-600 hover:underline"
            >
              ← Back to drawing
            </Link>
            <p className="mt-1 text-sm font-medium text-slate-800">{analysis.sourceFileName}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => {
                exportComplianceCsv(result);
                setExportNote("Downloaded compliance CSV");
              }}
            >
              Export CSV
            </button>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => {
                exportAnalysisJson(result);
                setExportNote("Downloaded analysis JSON");
              }}
            >
              Export JSON
            </button>
            {exportNote ? <span className="text-[11px] text-slate-500">{exportNote}</span> : null}
          </div>
        </div>

        <div className="min-h-0 flex-1">
          <PlanViewer result={result} />
        </div>

        <div className="h-52 shrink-0 overflow-y-auto border-t border-slate-200 bg-white p-3">
          <ResultsTable
            result={result}
            selectedId={selectedId}
            onSelectEntity={(id) => selectObject(id)}
          />
        </div>
      </div>
    </WorkspaceShell>
  );
}
