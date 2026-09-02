"use client";

import { useMemo, useState } from "react";
import type { AnalysisResult, BuildingHierarchy, ComplianceResult } from "@highlife/shared-types";
import type { OverlayEntity } from "@/features/plan-editor/types";
import { computeApartmentSheet } from "@/lib/hierarchy/apartmentCharacteristics";
import { computeMetricLayer } from "@/lib/fpr/metricLayer";
import { buildLateFusionGraph } from "@/lib/fpr/lateFusion";
import { buildVlmGraphPrompt } from "@/lib/fpr/vlmGraphReasoning";
import { evidenceEntityIds, exportAnalysisJson, exportComplianceCsv } from "@/lib/export/analysisExport";
import { HeadingHint } from "@/components/ui/HoverHint";
import { PolicySourceReviewDialog } from "@/features/policy/PolicySourceReviewDialog";
import { formatArea, formatConfidence } from "@/lib/utils";
import { allPolicyPacks, RDS_DEFAULT_ID, usePolicyStore } from "@/lib/policy/usePolicyStore";

function dashArea(m2: number | null | undefined): string {
  return m2 == null ? "—" : formatArea(m2);
}

const RESULT_STYLES: Record<string, string> = {
  pass: "bg-green-50 text-green-700",
  fail: "bg-red-50 text-red-700",
  uncertain: "bg-amber-50 text-amber-700",
  not_applicable: "bg-slate-50 text-slate-600",
  not_implemented: "bg-slate-50 text-slate-500",
};

export function overlayIdsForReviewPick(result: AnalysisResult, id: string): string[] {
  const unit = result.units.find((u) => u.id === id || u.externalId === id);
  if (unit) return [unit.id, ...unit.spaceIds];
  const treeUnit = result.hierarchy?.units.find((u) => u.id === id || u.label === id);
  if (treeUnit) return [treeUnit.id, ...treeUnit.roomIds];
  const summary = result.unitSummaries.find((u) => u.unitId === id);
  if (summary) {
    const match = result.units.find((u) => u.id === summary.unitId || u.externalId === summary.unitId);
    if (match) return [match.id, ...match.spaceIds];
  }
  return [id];
}

export function findSelectedApartment<T extends { unitId: string; label: string; evidenceIds: string[] }>(
  apartments: T[],
  selectedId: string | null | undefined,
): T | null {
  if (!selectedId) return null;
  return (
    apartments.find((apt) => apt.unitId === selectedId) ??
    apartments.find((apt) => apt.label === selectedId) ??
    apartments.find((apt) => apt.evidenceIds.includes(selectedId)) ??
    null
  );
}

type ReviewPanelProps = {
  result: AnalysisResult | null | undefined;
  hierarchy?: BuildingHierarchy | null;
  entities?: OverlayEntity[];
  pixelsPerMeter?: number | null;
  levelName?: string | null;
  ocrLines?: { text?: string; bbox?: [number, number][] | null }[];
  selectedId?: string | null;
  onSelect?: (ids: string[]) => void;
  onPolicy?: () => void;
  onCancelPolicy?: () => void;
  policyBusy?: boolean;
  policyError?: string | null;
  projectId?: string;
};

export function ReviewPanel({
  result,
  hierarchy,
  entities = [],
  pixelsPerMeter = null,
  levelName = null,
  ocrLines = [],
  selectedId,
  onSelect,
  onPolicy,
  onCancelPolicy,
  policyBusy,
  policyError,
  projectId,
}: ReviewPanelProps) {
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [policyReviewOpen, setPolicyReviewOpen] = useState(false);
  const uploads = usePolicyStore((s) => s.uploads);
  const activeId = usePolicyStore((s) =>
    projectId ? s.activeByProject[projectId] || RDS_DEFAULT_ID : RDS_DEFAULT_ID,
  );
  const selectedGuidelineId = usePolicyStore((s) => s.selectedGuidelineId);
  const setSelectedGuideline = usePolicyStore((s) => s.setSelectedGuideline);
  const setGuidelineStatus = usePolicyStore((s) => s.setGuidelineStatus);
  const setGroupGuidelineStatus = usePolicyStore((s) => s.setGroupGuidelineStatus);
  const packs = useMemo(() => allPolicyPacks(uploads), [uploads]);
  const policyPack = packs.find((p) => p.id === activeId) ?? packs[0];
  const policyGuidelines = policyPack?.guidelines ?? [];
  const selectedGuideline =
    policyGuidelines.find((g) => g.id === selectedGuidelineId) ?? policyGuidelines[0] ?? null;
  const sheet = useMemo(
    () =>
      computeApartmentSheet({
        hierarchy: hierarchy ?? result?.hierarchy,
        entities,
        pixelsPerMeter,
        levelName,
        ocrLines,
      }),
    [entities, hierarchy, levelName, ocrLines, pixelsPerMeter, result?.hierarchy],
  );
  const metrics = useMemo(() => computeMetricLayer(entities, pixelsPerMeter), [entities, pixelsPerMeter]);
  const [vlmNote, setVlmNote] = useState<string | null>(null);
  const units = result?.unitSummaries ?? [];
  const selectedApt = useMemo(
    () => findSelectedApartment(sheet.apartments, selectedId),
    [sheet.apartments, selectedId],
  );
  const selectedSummary = useMemo(
    () => (selectedId ? units.find((u) => u.unitId === selectedId) ?? null : null),
    [selectedId, units],
  );
  const checks = result?.complianceResults ?? [];
  const warnings = result?.reviewWarnings ?? [];
  const failCount = checks.filter((c) => c.result === "fail" || c.result === "uncertain").length;

  const pickUnit = (unitId: string) => {
    if (!result) {
      onSelect?.([unitId]);
      return;
    }
    onSelect?.(overlayIdsForReviewPick(result, unitId));
  };

  const pickCheck = (cr: ComplianceResult) => {
    if (!result) return;
    const ids = evidenceEntityIds(cr);
    const unit = result.units.find((u) => u.externalId === cr.unitExternalId);
    onSelect?.(ids.length ? ids : overlayIdsForReviewPick(result, unit?.id ?? cr.unitExternalId));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {policyBusy ? (
          <button
            type="button"
            className="btn-compact-secondary"
            onClick={onCancelPolicy}
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="btn-compact-primary"
            disabled={!onPolicy}
            onClick={onPolicy}
          >
            Policy check
          </button>
        )}
        {policyGuidelines.length ? (
          <button type="button" className="btn-compact-secondary" onClick={() => setPolicyReviewOpen(true)}>
            Review all {policyGuidelines.length} rules
          </button>
        ) : null}
        <div className="btn-segment-group" role="group" aria-label="Export">
        <button
          type="button"
          className="btn-segment"
          disabled={!result}
          onClick={() => {
            if (!result) return;
            exportComplianceCsv(result);
            setExportNote("CSV downloaded");
          }}
        >
          CSV
        </button>
        <button
          type="button"
          className="btn-segment"
          disabled={!result}
          onClick={() => {
            if (!result) return;
            exportAnalysisJson(result);
            setExportNote("JSON downloaded");
          }}
        >
          JSON
        </button>
        <button
          type="button"
          className="btn-segment"
          disabled={!entities.length}
          onClick={() => {
            const graph = buildLateFusionGraph({
              analysisId: result?.analysisId ?? "local",
              projectId: result?.projectId ?? "local",
              pageId: "page",
              entities,
              pixelsPerMeter,
            });
            const prompt = buildVlmGraphPrompt(graph);
            setVlmNote(`${prompt.system}\n\n${prompt.user.slice(0, 400)}…`);
          }}
        >
          VLM prompt
        </button>
        </div>
      </div>
      {exportNote ? <p className="text-xs text-slate-500">{exportNote}</p> : null}
      {vlmNote ? (
        <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 px-1.5 py-1 text-xs leading-snug text-slate-600">
          {vlmNote}
        </pre>
      ) : null}
      {policyError ? <p className="text-xs leading-snug text-red-600">{policyError}</p> : null}

      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Dimensions{metrics.length ? ` · ${metrics.length}` : ""}
        </p>
        {metrics.length === 0 ? (
          <p className="text-xs leading-snug text-slate-400">
            Detect walls, rooms, and openings. Areas stay — until scale is set.
          </p>
        ) : (
          <ul className="hl-block max-h-36 divide-y divide-slate-100 overflow-auto">
            {metrics.slice(0, 40).map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-1 px-1.5 py-0.5 text-left text-xs hover:bg-slate-50"
                  onClick={() => onSelect?.(row.sourceGeometryIds)}
                >
                  <span className="w-24 shrink-0 truncate text-slate-400">{row.kind}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-700">{row.label}</span>
                  <span className="shrink-0 tabular-nums text-slate-500">
                    {row.valueM2 != null
                      ? dashArea(row.valueM2)
                      : row.valueMm != null
                        ? `${Math.round(row.valueMm)} mm`
                        : "—"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1">
        <HeadingHint
          title={`Unit${sheet.apartments.length ? ` · ${sheet.apartments.length}` : units.length ? ` · ${units.length}` : ""}`}
          as="p"
          className="text-xs font-semibold uppercase tracking-wider text-slate-400"
          hint="Select a unit on the plan or in the list. Type, area, and aspect stay on the selected unit only."
        />
        {sheet.warnings.map((w) => (
          <p key={w} className="text-xs leading-snug text-amber-700">
            {w}
          </p>
        ))}
        {sheet.apartments.length === 0 && units.length === 0 ? (
          <p className="text-xs leading-snug text-slate-400">
            Detect rooms, infer units, and set scale. Characteristics stay on this sheet.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1">
              {sheet.apartments.length
                ? sheet.apartments.map((apt) => {
                    const active = selectedApt?.unitId === apt.unitId;
                    return (
                      <button
                        key={apt.unitId}
                        type="button"
                        className={`rounded border px-2 py-0.5 text-xs font-medium ${
                          active
                            ? "border-teal-700 bg-teal-700 text-white"
                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                        onClick={() =>
                          onSelect?.(apt.evidenceIds.length ? apt.evidenceIds : [apt.unitId])
                        }
                      >
                        {apt.label}
                      </button>
                    );
                  })
                : units.map((unit) => (
                    <button
                      key={unit.unitId}
                      type="button"
                      className={`rounded border px-2 py-0.5 text-xs font-medium ${
                        selectedSummary?.unitId === unit.unitId
                          ? "border-teal-700 bg-teal-700 text-white"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                      onClick={() => pickUnit(unit.unitId)}
                    >
                      {unit.unitId}
                    </button>
                  ))}
            </div>
            {selectedApt ? (
              <div className="hl-block space-y-1 px-1.5 py-1.5">
                <span className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800">
                    {selectedApt.label}
                  </span>
                  <span className="shrink-0 tabular-nums text-xs text-slate-500">
                    {dashArea(selectedApt.internalAreaM2)}
                  </span>
                  {selectedApt.reviewStatus === "review_required" ? (
                    <span className="shrink-0 rounded bg-amber-100 px-1 text-xs font-medium text-amber-800">
                      Review
                    </span>
                  ) : null}
                </span>
                <p className="text-xs leading-snug text-slate-500">
                  {selectedApt.apartmentType ? `Type ${selectedApt.apartmentType} · ` : ""}
                  {selectedApt.bedroomCount} bed
                  {selectedApt.detectedBedroomCount > 0 &&
                  selectedApt.detectedBedroomCount !== selectedApt.bedroomCount
                    ? ` (${selectedApt.detectedBedroomCount} labelled)`
                    : ""}
                  {" · "}
                  {selectedApt.bathroomCount} bath
                  {selectedApt.separateToiletCount ? ` · ${selectedApt.separateToiletCount} WC` : ""}
                </p>
                <p className="text-xs leading-snug text-slate-500">
                  Balcony {dashArea(selectedApt.balconyAreaM2)} · Court{" "}
                  {dashArea(selectedApt.courtyardAreaM2)}
                </p>
                <p className="text-xs leading-snug text-slate-500">
                  Aspect{" "}
                  {selectedApt.mainAspect
                    ? `${selectedApt.mainAspect}${selectedApt.mainAspectDeg != null ? ` ${Math.round(selectedApt.mainAspectDeg)}°` : ""}`
                    : "—"}
                  {selectedApt.aspectKind ? ` · ${selectedApt.aspectKind}` : ""}
                  {selectedApt.windowsOnTwoSides ? " · 2 sides" : ""}
                </p>
              </div>
            ) : selectedSummary ? (
              <div className="hl-block space-y-0.5 px-1.5 py-1.5">
                <span className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800">
                    {selectedSummary.unitId}
                  </span>
                  <span className="shrink-0 tabular-nums text-xs text-slate-500">
                    {formatArea(selectedSummary.areaM2)}
                  </span>
                </span>
                <p className="text-xs text-slate-500">
                  {selectedSummary.roomCount} rooms · {selectedSummary.bedroomCount} bed ·{" "}
                  {formatConfidence(selectedSummary.confidence)}
                </p>
              </div>
            ) : (
              <p className="text-xs leading-snug text-slate-400">
                Select a unit to see type, area, and aspect.
              </p>
            )}
          </>
        )}
        <button
          type="button"
          className="hl-block w-full px-1.5 py-1 text-left hover:bg-slate-50"
          onClick={() =>
            sheet.communalOutdoor.evidenceIds.length
              ? onSelect?.(sheet.communalOutdoor.evidenceIds)
              : undefined
          }
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Outdoor communal
          </p>
          <p className="text-xs leading-snug text-slate-600">
            {sheet.communalOutdoor.present
              ? `${dashArea(sheet.communalOutdoor.areaM2)} · ${sheet.communalOutdoor.location}`
              : "Not present"}
          </p>
        </button>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Policy{checks.length ? ` · ${checks.length}` : ""}
          {failCount ? ` · ${failCount} open` : ""}
        </p>
        {checks.length === 0 ? (
          <p className="text-xs leading-snug text-slate-400">No policy results yet.</p>
        ) : (
          <ul className="hl-block divide-y divide-slate-100">
            {checks.map((cr) => {
              const ids = evidenceEntityIds(cr);
              const active = selectedId != null && (ids.includes(selectedId) || selectedId === cr.unitExternalId);
              return (
                <li key={cr.id}>
                  <button
                    type="button"
                    className={`flex w-full flex-col gap-0.5 px-1.5 py-1 text-left ${
                      active ? "bg-teal-50" : "hover:bg-slate-50"
                    }`}
                    onClick={() => pickCheck(cr)}
                  >
                    <span className="flex items-center gap-1">
                      <span className={`rounded px-1 text-xs font-medium ${RESULT_STYLES[cr.result] ?? ""}`}>
                        {cr.result}
                      </span>
                      <span className="truncate font-mono text-xs text-slate-700">{cr.ruleCode}</span>
                      <span className="ml-auto truncate text-xs text-slate-400">{cr.unitExternalId}</span>
                    </span>
                    <span className="text-xs leading-snug text-slate-500">{cr.explanation}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {result?.policyVersion ? (
          <p className="text-xs text-slate-400">
            {result.policyVersion}
            {result.modelVersions?.policy ? ` · ${result.modelVersions.policy}` : ""}
          </p>
        ) : null}
      </div>

      {warnings.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Warnings</p>
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li
                key={`${w.code}-${i}`}
                className="rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-xs leading-snug text-amber-900"
              >
                {w.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {policyPack && policyGuidelines.length ? (
        <PolicySourceReviewDialog
          open={policyReviewOpen}
          title={policyPack.name}
          guidelines={policyGuidelines}
          rules={policyPack.rules}
          selected={selectedGuideline}
          onClose={() => setPolicyReviewOpen(false)}
          onSelect={setSelectedGuideline}
          onStatus={(id, status) => setGuidelineStatus(policyPack.id, id, status)}
          onGroupStatus={(group, status) => setGroupGuidelineStatus(policyPack.id, group, status)}
        />
      ) : null}
    </div>
  );
}
