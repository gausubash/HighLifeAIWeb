"use client";

import { useEffect, useState } from "react";
import type { PolicyGuideline, PolicyGuidelineStatus, PolicyRule } from "@highlife/shared-types";
import { PolicyGuidelineDetail } from "@/features/policy/PolicyGuidelineDetail";
import { HoverHint } from "@/components/ui/HoverHint";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<PolicyGuidelineStatus, string> = {
  pending: "bg-amber-50 text-amber-800",
  accepted: "bg-green-50 text-green-700",
  rejected: "bg-slate-100 text-slate-500",
};

type PolicyGuidelineListProps = {
  guidelines: PolicyGuideline[];
  selectedId: string | null;
  rules?: PolicyRule[];
  showDetail?: boolean;
  onSelect: (id: string) => void;
  onStatus: (id: string, status: PolicyGuidelineStatus) => void;
  onGroupStatus: (group: string, status: PolicyGuidelineStatus) => void;
};

function groupOrder(guidelines: PolicyGuideline[]): string[] {
  const seen: string[] = [];
  for (const g of guidelines) {
    if (!seen.includes(g.group)) seen.push(g.group);
  }
  return seen;
}

export function PolicyGuidelineList({
  guidelines,
  selectedId,
  rules = [],
  showDetail = true,
  onSelect,
  onStatus,
  onGroupStatus,
}: PolicyGuidelineListProps) {
  const groups = groupOrder(guidelines);
  const pending = guidelines.filter((g) => g.status === "pending").length;
  const accepted = guidelines.filter((g) => g.status === "accepted").length;
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const isGroupExpanded = (group: string) => expandedGroups[group] ?? false;

  useEffect(() => {
    if (!selectedId) return;
    const group = guidelines.find((g) => g.id === selectedId)?.group;
    if (!group) return;
    setExpandedGroups((prev) => (prev[group] ? prev : { ...prev, [group]: true }));
  }, [guidelines, selectedId]);

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => ({ ...prev, [group]: !isGroupExpanded(group) }));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Rules · {guidelines.length}
          </p>
          <HoverHint
            text="Accept guidelines you want checked on the plan. Skipped rules stay as reference only. Groups collapse by default — expand to review individual rules."
            label="About policy rules"
          />
        </div>
        <p className="shrink-0 text-xs text-slate-500">
          {accepted} accepted · {pending} to review
        </p>
      </div>
      {groups.map((group) => {
        const items = guidelines.filter((g) => g.group === group);
        const open = isGroupExpanded(group);
        return (
          <section key={group} className="hl-block overflow-hidden">
            <div className="flex items-start justify-between gap-2 bg-slate-50 px-2 py-1.5">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                aria-expanded={open}
                onClick={() => toggleGroup(group)}
              >
                <span className="w-3 shrink-0 text-center text-[11px] text-slate-400">
                  {open ? "▾" : "▸"}
                </span>
                <h3 className="min-w-0 flex-1 text-sm font-semibold leading-snug text-slate-800">
                  {group}
                </h3>
                <span className="shrink-0 text-xs tabular-nums text-slate-400">{items.length}</span>
              </button>
              <div className="flex shrink-0 items-center gap-2 pt-0.5">
                <button
                  type="button"
                  className="text-xs text-teal-800 hover:underline"
                  onClick={() => onGroupStatus(group, "accepted")}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="text-xs text-slate-500 hover:underline"
                  onClick={() => onGroupStatus(group, "rejected")}
                >
                  Skip
                </button>
              </div>
            </div>
            {open ? (
            <ul className="divide-y divide-slate-100">
              {items.map((guideline) => {
                const selected = selectedId === guideline.id;
                return (
                  <li key={guideline.id} className={cn(selected && "bg-amber-50/70")}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-slate-50"
                      onClick={() => onSelect(guideline.id)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium leading-snug text-slate-800">
                          {guideline.name}
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-slate-500">
                          {guideline.clause ? `${guideline.clause} · ` : ""}
                          {guideline.page ? `p.${guideline.page} · ` : ""}
                          {guideline.mappedKind ? "can check on plan" : "review only"}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 rounded px-1 py-0.5 text-xs font-semibold uppercase ${STATUS_STYLES[guideline.status]}`}
                      >
                        {guideline.status}
                      </span>
                    </button>
                    {selected && showDetail ? (
                      <div className="space-y-1.5 px-2 pb-2">
                        <PolicyGuidelineDetail
                          guideline={guideline}
                          rule={rules.find((r) => r.guidelineId === guideline.id)}
                          compact
                        />
                        <div className="flex gap-1">
                          <button
                            type="button"
                            className="rounded bg-teal-800 px-2 py-0.5 text-xs font-medium text-white hover:bg-teal-700"
                            onClick={() => onStatus(guideline.id, "accepted")}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                            onClick={() => onStatus(guideline.id, "rejected")}
                          >
                            Reject
                          </button>
                          {guideline.status !== "pending" ? (
                            <button
                              type="button"
                              className="text-xs text-slate-500 hover:underline"
                              onClick={() => onStatus(guideline.id, "pending")}
                            >
                              Reset
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
