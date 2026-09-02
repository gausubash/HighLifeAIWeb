"use client";

import type { AnalysisResult, ComplianceResult } from "@highlife/shared-types";
import { formatArea, formatConfidence } from "@/lib/utils";
import { evidenceEntityIds } from "@/lib/export/analysisExport";

interface ResultsTableProps {
  result: AnalysisResult;
  onSelectEntity?: (id: string | null) => void;
  selectedId?: string | null;
}

const RESULT_STYLES: Record<string, string> = {
  pass: "text-green-700 bg-green-50",
  fail: "text-red-700 bg-red-50",
  uncertain: "text-amber-700 bg-amber-50",
  not_applicable: "text-slate-600 bg-slate-50",
  not_implemented: "text-slate-500 bg-slate-50",
};

export function ResultsTable({ result, onSelectEntity, selectedId }: ResultsTableProps) {
  const focusRow = (cr: ComplianceResult) => {
    const ids = evidenceEntityIds(cr);
    const unit = result.units.find((u) => u.externalId === cr.unitExternalId);
    const next = ids[0] ?? unit?.id ?? null;
    onSelectEntity?.(next);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Unit schedule</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="pb-2 pr-4 font-medium">Unit</th>
                <th className="pb-2 pr-4 font-medium">Area</th>
                <th className="pb-2 pr-4 font-medium">Rooms</th>
                <th className="pb-2 pr-4 font-medium">Bedrooms</th>
                <th className="pb-2 pr-4 font-medium">Open space</th>
                <th className="pb-2 pr-4 font-medium">Confidence</th>
                <th className="pb-2 font-medium">Review</th>
              </tr>
            </thead>
            <tbody>
              {result.unitSummaries.map((u) => (
                <tr
                  key={u.unitId}
                  className={`border-b border-slate-100 ${selectedId === u.unitId ? "bg-brand-50" : ""}`}
                >
                  <td className="py-2 pr-4 font-medium">
                    <button
                      type="button"
                      className="text-left text-brand-700 hover:underline"
                      onClick={() => onSelectEntity?.(u.unitId)}
                    >
                      {u.unitId}
                    </button>
                  </td>
                  <td className="py-2 pr-4">{formatArea(u.areaM2)}</td>
                  <td className="py-2 pr-4">{u.roomCount}</td>
                  <td className="py-2 pr-4">{u.bedroomCount}</td>
                  <td className="py-2 pr-4">{formatArea(u.privateOpenSpaceAreaM2)}</td>
                  <td className="py-2 pr-4">{formatConfidence(u.confidence)}</td>
                  <td className="py-2">
                    {u.reviewStatus === "review_required" ? (
                      <span className="badge bg-amber-100 text-amber-800">Required</span>
                    ) : (
                      <span className="badge bg-green-100 text-green-800">OK</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Compliance results</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="pb-2 pr-4 font-medium">Unit</th>
                <th className="pb-2 pr-4 font-medium">Rule</th>
                <th className="pb-2 pr-4 font-medium">Result</th>
                <th className="pb-2 pr-4 font-medium">Measured</th>
                <th className="pb-2 pr-4 font-medium">Required</th>
                <th className="pb-2 font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {result.complianceResults.map((cr) => {
                const ids = evidenceEntityIds(cr);
                const active = selectedId != null && ids.includes(selectedId);
                return (
                  <tr
                    key={cr.id}
                    className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${
                      active ? "bg-brand-50" : ""
                    }`}
                    onClick={() => focusRow(cr)}
                  >
                    <td className="py-2 pr-4">{cr.unitExternalId}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{cr.ruleCode}</td>
                    <td className="py-2 pr-4">
                      <span className={`badge ${RESULT_STYLES[cr.result] ?? ""}`}>
                        {cr.result}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      {cr.measuredValue != null ? `${cr.measuredValue} ${cr.unit ?? ""}` : "—"}
                    </td>
                    <td className="py-2 pr-4">
                      {cr.requiredValue != null ? `${cr.requiredValue} ${cr.unit ?? ""}` : "—"}
                    </td>
                    <td className="py-2">{formatConfidence(cr.confidence)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {result.complianceResults.map((cr) => (
            <span key={cr.id} className="mb-1 block">
              <span className="font-mono">{cr.ruleCode}</span>: {cr.explanation}
            </span>
          ))}
        </p>
        {result.reviewWarnings?.length ? (
          <p className="mt-2 text-xs text-amber-700">
            {result.reviewWarnings.map((w) => (
              <span key={`${w.code}-${w.message}`} className="mb-1 block">
                {w.code}: {w.message}
              </span>
            ))}
          </p>
        ) : null}
        <p className="mt-2 text-[13px] text-slate-400">
          Policy {result.policyVersion}
          {result.modelVersions?.policy ? ` · pack ${result.modelVersions.policy}` : ""}
          {result.modelVersions?.detect ? ` · detect ${result.modelVersions.detect}` : ""}
          {onSelectEntity ? " · click a compliance row to highlight evidence" : ""}
        </p>
      </div>
    </div>
  );
}
