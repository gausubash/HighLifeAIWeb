import type { Analysis } from "@highlife/shared-types";
import { STAGE_LABELS } from "@highlife/shared-types";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/utils";

interface AnalysisStatusPanelProps {
  analysis: Analysis;
}

export function AnalysisStatusPanel({ analysis }: AnalysisStatusPanelProps) {
  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{analysis.sourceFileName}</h2>
        <StatusBadge status={analysis.status} />
      </div>

      <div>
        <div className="mb-1 flex justify-between text-sm">
          <span className="text-slate-600">
            {STAGE_LABELS[analysis.currentStage]}
          </span>
          <span className="font-medium">{analysis.progress}%</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-brand-600 transition-all duration-500"
            style={{ width: `${analysis.progress}%` }}
          />
        </div>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-500">Created</dt>
          <dd>{formatDate(analysis.createdAt)}</dd>
        </div>
        {analysis.startedAt && (
          <div>
            <dt className="text-slate-500">Started</dt>
            <dd>{formatDate(analysis.startedAt)}</dd>
          </div>
        )}
        {analysis.completedAt && (
          <div>
            <dt className="text-slate-500">Completed</dt>
            <dd>{formatDate(analysis.completedAt)}</dd>
          </div>
        )}
        {analysis.pageCount != null && (
          <div>
            <dt className="text-slate-500">Pages</dt>
            <dd>{analysis.pageCount}</dd>
          </div>
        )}
        {analysis.unitCount != null && (
          <div>
            <dt className="text-slate-500">Units detected</dt>
            <dd>{analysis.unitCount}</dd>
          </div>
        )}
        {analysis.reviewCount != null && (
          <div>
            <dt className="text-slate-500">Items requiring review</dt>
            <dd>{analysis.reviewCount}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
