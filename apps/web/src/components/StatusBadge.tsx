import type { AnalysisStatus } from "@highlife/shared-types";

const STATUS_STYLES: Record<AnalysisStatus, string> = {
  queued: "bg-slate-100 text-slate-700",
  processing: "bg-blue-100 text-blue-800",
  review_required: "bg-amber-100 text-amber-800",
  completed: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-slate-100 text-slate-500",
};

const STATUS_LABELS: Record<AnalysisStatus, string> = {
  queued: "Queued",
  processing: "Processing",
  review_required: "Review required",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

interface StatusBadgeProps {
  status: AnalysisStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`badge ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}
