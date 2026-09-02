import type { PolicyGuideline, PolicyRule } from "@highlife/shared-types";
import { PolicyRuleGraphic } from "@/features/policy/PolicyRuleGraphic";
import { formatHooperThreshold } from "@/lib/policy/hooperApartmentRules";
import { explainGuideline, ruleBands } from "@/lib/policy/policyExplain";

function stubRule(guideline: PolicyGuideline, rule?: PolicyRule): PolicyRule {
  if (rule) return rule;
  return {
    code: guideline.id,
    name: guideline.name,
    kind: guideline.mappedKind ?? "room_min_area",
    clause: guideline.clause,
    sourceText: guideline.text,
    minAreaM2: guideline.unit === "m2" ? guideline.value : undefined,
    minDimensionM: guideline.unit === "m" ? guideline.value : undefined,
    minCount: guideline.unit === "count" || guideline.unit === "boolean" ? guideline.value : undefined,
    m2PerDwelling: guideline.unit === "m2_per_apartment" ? guideline.value : undefined,
  };
}

type PolicyGuidelineDetailProps = {
  guideline: PolicyGuideline;
  rule?: PolicyRule;
  compact?: boolean;
};

export function PolicyGuidelineDetail({ guideline, rule, compact }: PolicyGuidelineDetailProps) {
  const explain = explainGuideline(guideline, rule);
  const graphicRule = stubRule(guideline, rule);
  const bands = rule ? ruleBands(rule) : [];
  const threshold = formatHooperThreshold(guideline.operator, guideline.value, guideline.unit);
  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <PolicyRuleGraphic kind={explain.graphic} rule={graphicRule} />
      </div>
      {threshold ? (
        <p className="text-[13px] font-semibold tabular-nums text-teal-800">
          {threshold}
          {guideline.level ? ` · ${guideline.level}` : ""}
        </p>
      ) : null}
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
      <p className={`leading-relaxed text-slate-700 ${compact ? "text-xs" : "text-[14px]"}`}>
        {guideline.text}
      </p>
      {guideline.policies?.length ? (
        <p className="text-xs text-slate-500">{guideline.policies.join(" · ")}</p>
      ) : null}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {guideline.mappedKind ? "How we check" : "How to use this rule"}
        </p>
        <ul className="mt-0.5 list-disc space-y-0.5 pl-3.5 text-xs leading-snug text-slate-600">
          {explain.how.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      </div>
      {guideline.variable ? (
        <p className="font-mono text-xs text-slate-400">{guideline.variable}</p>
      ) : null}
    </div>
  );
}
