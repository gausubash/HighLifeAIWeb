import type { AnalysisResult } from "@highlife/shared-types";
import { formatArea, formatConfidence } from "@/lib/utils";

interface ResultsTableProps {
  result: AnalysisResult;
}

const RESULT_STYLES: Record<string, string> = {
  pass: "text-green-700 bg-green-50",
  fail: "text-red-700 bg-red-50",
  uncertain: "text-amber-700 bg-amber-50",
  not_applicable: "text-slate-600 bg-slate-50",
  not_implemented: "text-slate-500 bg-slate-50",
};

export function ResultsTable({ result }: ResultsTableProps) {
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
                <tr key={u.unitId} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-medium">{u.unitId}</td>
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
              {result.complianceResults.map((cr) => (
                <tr key={cr.id} className="border-b border-slate-100">
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
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">{result.complianceResults[0]?.explanation}</p>
      </div>
    </div>
  );
}
