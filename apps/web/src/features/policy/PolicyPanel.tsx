"use client";

import { useMemo, useRef, useState } from "react";
import type { ComplianceResult, PolicyRule } from "@highlife/shared-types";
import { PolicyGuidelineList } from "@/features/policy/PolicyGuidelineList";
import { PolicyRuleGraphic } from "@/features/policy/PolicyRuleGraphic";
import { PolicySourcePreview } from "@/features/policy/PolicySourcePreview";
import { PolicySourceReviewDialog } from "@/features/policy/PolicySourceReviewDialog";
import { HoverHint } from "@/components/ui/HoverHint";
import { ingestPolicyFile } from "@/lib/policy/ingestPolicyFile";
import { complianceRules } from "@/lib/policy/evaluatePolicy";
import { explainPolicyRule, ruleBands } from "@/lib/policy/policyExplain";
import { allPolicyPacks, RDS_DEFAULT_ID, usePolicyStore } from "@/lib/policy/usePolicyStore";

const KIND_LABEL: Record<string, string> = {
  room_min_area: "Room area",
  required_labels: "Required rooms",
  min_wall_count: "Walls",
  apartment_min_internal: "Apartment size",
  apartment_min_living: "Living area",
  apartment_min_pos: "Private open space",
  apartment_min_bedroom: "Bedroom area",
  apartment_min_bathrooms: "Bathrooms",
  apartment_min_storage: "Storage",
  apartment_dual_aspect: "Dual aspect",
  habitable_has_window: "Habitable window",
  communal_open_space: "Communal open space",
};

const POLICY_HINTS = {
  upload:
    "Upload a council / RDS PDF or JSON pack. PDFs are read with a vision model so tables drawn as images are included. Document groups are preserved and the clause is highlighted when you select a rule. Accept the guidelines you want to check.",
  compliance:
    "Run after Detect and scale are set. Accepted, checkable guidelines are evaluated per apartment. Results also appear on the Review tab.",
  acceptGuidelines: "Accept at least one guideline that can be checked on the plan before running compliance.",
  packDescription: "Summary of what this policy pack covers.",
} as const;

const RESULT_STYLES: Record<string, string> = {
  pass: "bg-green-50 text-green-700",
  fail: "bg-red-50 text-red-700",
  uncertain: "bg-amber-50 text-amber-700",
  not_applicable: "bg-slate-50 text-slate-600",
  not_implemented: "bg-slate-50 text-slate-500",
};

function ruleThreshold(rule: PolicyRule): string {
  if (rule.byBedrooms) {
    const parts = (["0", "1", "2", "3"] as const)
      .filter((k) => rule.byBedrooms?.[k] != null)
      .map((k) => `${k === "0" ? "studio" : `${k}bed`} ${rule.byBedrooms![k]}`);
    return parts.join(" · ");
  }
  if (rule.minAreaM2 != null) return `${rule.minAreaM2} m²`;
  if (rule.minCount != null) return `≥ ${rule.minCount}`;
  if (rule.m2PerDwelling != null) return `${rule.m2PerDwelling} m² / dwelling`;
  if (rule.minCommunalM2 != null) return `${rule.minCommunalM2} m²`;
  if (rule.requiredLabels?.length) return rule.requiredLabels.join(", ");
  if (rule.minWallCount != null) return `≥ ${rule.minWallCount} walls`;
  return KIND_LABEL[rule.kind] ?? rule.kind;
}

function policyPackLabel(pack: { name: string; source?: { kind?: string } | null }) {
  return `${pack.name}${pack.source?.kind === "builtin" ? " (built-in)" : ""}`;
}

function PolicyRuleDetail({ rule }: { rule: PolicyRule }) {
  const explain = explainPolicyRule(rule);
  const bands = ruleBands(rule);
  return (
    <div className="space-y-2 border-t border-slate-100 px-2 pb-2.5 pt-2">
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <PolicyRuleGraphic kind={explain.graphic} rule={rule} />
      </div>
      {bands.length ? (
        <ul className="grid grid-cols-2 gap-1">
          {bands.map((band) => (
            <li
              key={band.key}
              className="flex items-center justify-between rounded bg-teal-50 px-1.5 py-1 text-xs text-teal-900"
            >
              <span>{band.label}</span>
              <span className="font-semibold tabular-nums">{band.value} m²</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs leading-relaxed text-slate-600">{explain.summary}</p>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">How we check</p>
        <ul className="mt-0.5 list-disc space-y-0.5 pl-3.5 text-xs leading-snug text-slate-600">
          {explain.how.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      </div>
      {rule.minDimensionM != null && explain.graphic !== "pos" && explain.graphic !== "bedroom" && explain.graphic !== "living" ? (
        <p className="text-xs text-slate-600">Minimum dimension {rule.minDimensionM} m.</p>
      ) : null}
      {rule.sourceText ? (
        <p className="rounded bg-slate-50 px-1.5 py-1 text-xs leading-snug text-slate-500">
          “{rule.sourceText}”
        </p>
      ) : null}
      {explain.note ? <p className="text-xs leading-snug text-slate-400">{explain.note}</p> : null}
    </div>
  );
}

type PolicyPanelProps = {
  projectId: string;
  checks?: ComplianceResult[];
  onRunCheck?: () => void;
  onCancelCheck?: () => void;
  busy?: boolean;
  error?: string | null;
  apartmentCount?: number;
};

export function PolicyPanel({
  projectId,
  checks = [],
  onRunCheck,
  onCancelCheck,
  busy,
  error,
  apartmentCount = 0,
}: PolicyPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const reattachRef = useRef<HTMLInputElement>(null);
  const uploads = usePolicyStore((s) => s.uploads);
  const activeId = usePolicyStore((s) => s.activeByProject[projectId] || RDS_DEFAULT_ID);
  const addPack = usePolicyStore((s) => s.addPack);
  const setActive = usePolicyStore((s) => s.setActive);
  const removePack = usePolicyStore((s) => s.removePack);
  const pdfBytesByPackId = usePolicyStore((s) => s.pdfBytesByPackId);
  const selectedGuidelineId = usePolicyStore((s) => s.selectedGuidelineId);
  const setSelectedGuideline = usePolicyStore((s) => s.setSelectedGuideline);
  const setPdfBytes = usePolicyStore((s) => s.setPdfBytes);
  const setGuidelineStatus = usePolicyStore((s) => s.setGuidelineStatus);
  const setGroupGuidelineStatus = usePolicyStore((s) => s.setGroupGuidelineStatus);
  const packs = useMemo(() => allPolicyPacks(uploads), [uploads]);
  const active = packs.find((p) => p.id === activeId) ?? packs[0];
  const guidelines = active?.guidelines ?? [];
  const selected = guidelines.find((g) => g.id === selectedGuidelineId) ?? guidelines[0] ?? null;
  const runnable = active ? complianceRules(active) : [];
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [ingestNote, setIngestNote] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [openCode, setOpenCode] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const fail = checks.filter((c) => c.result === "fail").length;
  const pass = checks.filter((c) => c.result === "pass").length;
  const other = checks.length - fail - pass;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setIngesting(true);
    setIngestError(null);
    setIngestNote(null);
    try {
      const { pack, provider, pdfBytes } = await ingestPolicyFile(file);
      addPack(pack, pdfBytes);
      setActive(projectId, pack.id);
      if (pack.guidelines?.length) setReviewOpen(true);
      const extracted = pack.guidelines?.length ?? pack.rules.length;
      setIngestNote(
        pack.guidelines?.length
          ? `${provider === "vision" ? "Read pages (including tables)" : provider === "llm" ? "Read" : "Extracted"} ${extracted} guideline${extracted === 1 ? "" : "s"} from “${pack.name}”. Accept the ones you want to check.`
          : `Loaded “${pack.name}” · ${pack.rules.length} rules.`,
      );
    } catch (e) {
      setIngestError(e instanceof Error ? e.message : "Could not read policy file.");
    } finally {
      setIngesting(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-slate-700">Active Policy</p>
        {active ? (
          <p className="mt-1 text-sm font-medium leading-snug text-slate-800 break-words">
            {policyPackLabel(active)}
          </p>
        ) : null}
        <select
          id="policy-pack-select"
          className="hl-input mt-2 min-h-10 w-full min-w-0 py-2 pl-2 pr-8 text-sm leading-normal"
          value={active?.id ?? ""}
          title={active ? policyPackLabel(active) : undefined}
          aria-label="Active policy"
          onChange={(e) => setActive(projectId, e.target.value)}
        >
          {packs.map((pack) => (
            <option key={pack.id} value={pack.id}>
              {policyPackLabel(pack)}
            </option>
          ))}
        </select>
      </div>

      <div className="hl-block border-dashed bg-slate-50 px-2.5 py-2">
        <div className="flex items-center gap-1">
          <p className="text-sm font-medium text-slate-700">Upload policy</p>
          <HoverHint text={POLICY_HINTS.upload} label="About policy upload" />
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.json,.yaml,.yml,application/pdf,application/json"
          className="sr-only"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <button
          type="button"
          className="mt-1.5 rounded bg-slate-900 px-2.5 py-1 text-[13px] font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          disabled={ingesting}
          onClick={() => inputRef.current?.click()}
        >
          {ingesting ? "Reading…" : "Upload PDF or JSON"}
        </button>
        {active && active.source?.kind !== "builtin" ? (
          <button
            type="button"
            className="ml-2 text-[13px] text-red-700 hover:underline"
            onClick={() => {
              removePack(active.id);
              setActive(projectId, RDS_DEFAULT_ID);
            }}
          >
            Remove pack
          </button>
        ) : null}
      </div>
      {ingestNote ? <p className="text-xs leading-snug text-teal-800">{ingestNote}</p> : null}
      {ingestError ? <p className="text-xs leading-snug text-red-600">{ingestError}</p> : null}

      {guidelines.length && active ? (
        <div className="space-y-2">
          <button
            type="button"
            className="btn-compact-secondary w-full"
            onClick={() => setReviewOpen(true)}
          >
            Review all {guidelines.length} rules
          </button>
          {pdfBytesByPackId[active.id] ? (
          <PolicySourcePreview
            bytes={pdfBytesByPackId[active.id]}
            page={selected?.page}
            rects={selected?.rects}
            onReattach={() => reattachRef.current?.click()}
            onOpen={() => setReviewOpen(true)}
          />
          ) : selected ? (
            <p className="text-xs leading-snug text-slate-500">
              {selected.group} · {selected.mappedKind ? "can check on plan" : "guideline"}
            </p>
          ) : null}
          <input
            ref={reattachRef}
            type="file"
            accept=".pdf,application/pdf"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file || !active) return;
              void file.arrayBuffer().then((bytes) => setPdfBytes(active.id, bytes));
              e.target.value = "";
            }}
          />
          <PolicyGuidelineList
            guidelines={guidelines}
            selectedId={selected?.id ?? null}
            rules={active.rules}
            onSelect={setSelectedGuideline}
            onStatus={(id, status) => setGuidelineStatus(active.id, id, status)}
            onGroupStatus={(group, status) => setGroupGuidelineStatus(active.id, group, status)}
          />
          <PolicySourceReviewDialog
            open={reviewOpen}
            title={active.name}
            bytes={pdfBytesByPackId[active.id]}
            guidelines={guidelines}
            rules={active.rules}
            selected={selected}
            onClose={() => setReviewOpen(false)}
            onSelect={setSelectedGuideline}
            onStatus={(id, status) => setGuidelineStatus(active.id, id, status)}
            onGroupStatus={(group, status) => setGroupGuidelineStatus(active.id, group, status)}
            onReattach={() => reattachRef.current?.click()}
          />
        </div>
      ) : null}

      {active && !guidelines.length ? (
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Rules · {active.rules.length}
            </p>
            {active.description ? (
              <HoverHint text={active.description} label={POLICY_HINTS.packDescription} />
            ) : null}
          </div>
          <ul className="hl-block divide-y divide-slate-100">
            {active.rules.map((rule) => {
              const open = openCode === rule.code;
              return (
                <li key={rule.code}>
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-2 px-2 py-1.5 text-left hover:bg-slate-50"
                    aria-expanded={open}
                    onClick={() => setOpenCode(open ? null : rule.code)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-slate-800">
                        {rule.name}
                      </span>
                      <span className="block truncate text-xs text-slate-500">
                        {rule.clause || rule.code} · {KIND_LABEL[rule.kind] ?? rule.kind}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-600">
                      {ruleThreshold(rule)}
                    </span>
                  </button>
                  {open ? <PolicyRuleDetail rule={rule} /> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        {busy ? (
          <button type="button" className="btn-compact-secondary" onClick={onCancelCheck}>
            Cancel
          </button>
        ) : (
          <button
            type="button"
            className="btn-compact-primary"
            disabled={!onRunCheck || (guidelines.length > 0 && runnable.length === 0)}
            onClick={onRunCheck}
          >
            Check compliance
          </button>
        )}
        <HoverHint text={POLICY_HINTS.compliance} label="About compliance check" />
        {guidelines.length && runnable.length === 0 ? (
          <span className="flex items-center gap-1 text-xs text-slate-500">
            Accept a checkable guideline first
            <HoverHint text={POLICY_HINTS.acceptGuidelines} label="About accepted guidelines" />
          </span>
        ) : apartmentCount ? (
          <span className="text-xs text-slate-500">
            {apartmentCount} apartment{apartmentCount === 1 ? "" : "s"}
          </span>
        ) : (
          <span className="text-xs text-slate-500">Infer units first</span>
        )}
      </div>
      {error ? <p className="text-xs leading-snug text-red-600">{error}</p> : null}

      {checks.length ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Latest check · {pass} pass · {fail} fail
            {other ? ` · ${other} other` : ""}
          </p>
          <ul className="space-y-1">
            {checks.slice(0, 40).map((check) => (
              <li
                key={check.id}
                className="flex items-start justify-between gap-2 rounded border border-slate-100 px-2 py-1"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-slate-800">{check.ruleCode}</span>
                  <span className="block text-xs leading-snug text-slate-500">
                    {check.explanation}
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded px-1 py-0.5 text-xs font-semibold uppercase ${
                    RESULT_STYLES[check.result] ?? RESULT_STYLES.not_applicable
                  }`}
                >
                  {check.result.replace("_", " ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
