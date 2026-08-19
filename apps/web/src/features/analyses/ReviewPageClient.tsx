"use client";

import Link from "next/link";
import { PlanViewer } from "@/features/plan-viewer/PlanViewer";
import { LayerControls } from "@/features/plan-viewer/LayerControls";
import { UnitSidebar } from "@/features/units/UnitSidebar";
import { ResultsTable } from "@/features/compliance/ResultsTable";
import { mockStore } from "@/lib/mock/store";
import { mockAnalysisResult } from "@/lib/mock/result";

interface ReviewPageClientProps {
  projectId: string;
  analysisId: string;
}

export function ReviewPageClient({ projectId, analysisId }: ReviewPageClientProps) {
  const analysis = mockStore.getAnalysis(analysisId);
  const result = mockStore.getResult(analysisId) ?? {
    ...mockAnalysisResult,
    analysisId,
  };

  if (!analysis) {
    return (
      <div className="card text-center">
        <p className="text-slate-600">Analysis not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/projects/${projectId}/analyses/${analysisId}`}
          className="text-sm text-brand-600 hover:underline"
        >
          ← Analysis status
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Plan review</h1>
        <p className="text-sm text-slate-600">{analysis.sourceFileName}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="card">
          <PlanViewer result={result} />
        </div>
        <aside className="card">
          <LayerControls result={result} />
          <hr className="my-4 border-slate-200" />
          <UnitSidebar result={result} />
        </aside>
      </div>

      <div className="card">
        <ResultsTable result={result} />
      </div>

      <p className="text-xs text-slate-500">
        Professional-review disclaimer: results assist review only and do not constitute
        statutory approval. Uncertain geometry yields uncertain compliance outcomes.
      </p>
    </div>
  );
}
