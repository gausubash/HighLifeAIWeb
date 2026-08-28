"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type VerticalInspectorTab = {
  id: string;
  label: string;
  title?: string;
  badge?: string | number | null;
};

type VerticalInspectorTabsProps = {
  tabs: VerticalInspectorTab[];
  activeId: string;
  onChange: (id: string) => void;
  children: ReactNode;
  footer?: ReactNode;
};

export function VerticalInspectorTabs({
  tabs,
  activeId,
  onChange,
  children,
  footer,
}: VerticalInspectorTabsProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-3 pt-3">
          <div className="space-y-4 pb-3">{children}</div>
        </div>
        <nav
          className="flex w-9 shrink-0 flex-col border-l border-slate-200 bg-slate-50"
          aria-label="Inspector sections"
        >
          {tabs.map((tab) => {
            const active = tab.id === activeId;
            return (
              <button
                key={tab.id}
                type="button"
                title={tab.title ?? tab.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[3.25rem] flex-1 items-center justify-center border-b border-slate-200 px-0.5 py-2 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                  active
                    ? "bg-white text-slate-900 shadow-[inset_2px_0_0_0_#0f172a]"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
                )}
                style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
                onClick={() => onChange(tab.id)}
              >
                <span className="max-h-full truncate">{tab.label}</span>
                {tab.badge != null && tab.badge !== "" && tab.badge !== 0 ? (
                  <span
                    className={cn(
                      "absolute right-0.5 top-1 min-w-[14px] rounded-full px-1 text-center text-[8px] font-bold leading-[14px]",
                      active ? "bg-slate-900 text-white" : "bg-slate-300 text-slate-700",
                    )}
                    style={{ writingMode: "horizontal-tb" }}
                  >
                    {tab.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>
      {footer ? <div className="shrink-0 border-t border-slate-200 px-3 py-3">{footer}</div> : null}
    </div>
  );
}
