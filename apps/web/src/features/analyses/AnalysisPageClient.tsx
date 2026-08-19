"use client";

import Link from "next/link";
import { AnalysisStatusPanel } from "@/features/analyses/AnalysisStatusPanel";
import { useAnalysisProgress } from "@/hooks/useAnalysisProgress";

interface AnalysisPageClientProps {
  projectId: string;
  analysisId: string;
}

export function AnalysisPageClient({ projectId, analysisId }: AnalysisPageClientProps) {
  const { analysis } = useAnalysisProgress({ analysisId });

  if (!analysis) {
    return (
      <div className="card text-center">
        <p className="text-slate-600">Analysis not found.</p>
        <Link href={`/projects/${projectId}`} className="btn-primary mt-4 inline-flex">
          Back to project
        </Link>
      </div>
    );
  }

  const canReview =
    analysis.status === "review_required" || analysis.status === "completed";

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/projects/${projectId}`}
          className="text-sm text-brand-600 hover:underline"
        >
          ← {analysis.sourceFileName}
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Analysis status</h1>
      </div>

      <AnalysisStatusPanel analysis={analysis} />

      <div className="flex flex-wrap gap-3">
        {canReview && (
          <Link
            href={`/projects/${projectId}/analyses/${analysisId}/review`}
            className="btn-primary"
          >
            Open review viewer
          </Link>
        )}
        {analysis.status === "failed" && (
          <button type="button" className="btn-secondary">
            Retry analysis
          </button>
        )}
      </div>

      {analysis.status === "processing" && (
        <p className="text-sm text-slate-500">
          Mock worker simulating pipeline stages… Phase 3 connects to Supabase Realtime.
        </p>
      )}
    </div>
  );
}
