"use client";

import type { ReactNode, SVGProps } from "react";
import { cn } from "@/lib/utils";
import { useLayoutStore } from "@/features/plan-viewer/useLayoutStore";

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

function TabIcon({ id, ...props }: SVGProps<SVGSVGElement> & { id: string }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
  switch (id) {
    case "layout":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case "ocr":
      return (
        <svg {...common}>
          <path d="M4 7V5a1 1 0 0 1 1-1h3" />
          <path d="M16 4h3a1 1 0 0 1 1 1v2" />
          <path d="M20 17v2a1 1 0 0 1-1 1h-3" />
          <path d="M8 20H5a1 1 0 0 1-1-1v-2" />
          <path d="M8 8h8v8H8z" />
        </svg>
      );
    case "detect":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      );
    case "geometry":
      return (
        <svg {...common}>
          <path d="M12 3 21 8.5v7L12 21 3 15.5v-7L12 3Z" />
          <path d="M12 21v-7.5" />
          <path d="m3 8.5 9 5 9-5" />
          <circle cx="7" cy="8" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="17" cy="8" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="12" cy="17" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "hierarchy":
      return (
        <svg {...common}>
          <path d="M6 4h4v4H6z" />
          <path d="M14 10h4v4h-4z" />
          <path d="M14 16h4v4h-4z" />
          <path d="M10 6h2a2 2 0 0 1 2 2v10" />
        </svg>
      );
    case "policy":
      return (
        <svg {...common}>
          <path d="M12 3 5 6v6c0 4.2 2.8 7.4 7 8.5 4.2-1.1 7-4.3 7-8.5V6l-7-3Z" />
        </svg>
      );
    case "review":
      return (
        <svg {...common}>
          <path d="M8 6h11" />
          <path d="M8 12h11" />
          <path d="M8 18h11" />
          <path d="m4 6 1 1 2-2" />
          <path d="m4 12 1 1 2-2" />
          <path d="m4 18 1 1 2-2" />
        </svg>
      );
    case "project":
      return (
        <svg {...common}>
          <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h3.2l1.4 1.6H18.5A1.5 1.5 0 0 1 20 9.1v8.4A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-10Z" />
        </svg>
      );
    case "page":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2" />
          <circle cx="16" cy="16" r="2" />
          <path d="M10 8h8M6 16h8" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" />
        </svg>
      );
  }
}

export function VerticalInspectorTabs({
  tabs,
  activeId,
  onChange,
  children,
  footer,
}: VerticalInspectorTabsProps) {
  const inspectorOpen = useLayoutStore((s) => s.inspectorOpen);
  const setInspectorOpen = useLayoutStore((s) => s.setInspectorOpen);
  const toggleInspector = useLayoutStore((s) => s.toggleInspector);

  return (
    <div className="hl-panel-row h-full min-w-0 flex-1">
      <nav
        className="hl-activity-bar flex shrink-0 flex-col items-stretch"
        aria-label="Inspector sections"
      >
        {tabs.map((tab) => {
          const active = tab.id === activeId && inspectorOpen;
          return (
            <button
              key={tab.id}
              type="button"
              title={tab.title ?? tab.label}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-11 w-11 shrink-0 items-center justify-center transition-colors",
                active
                  ? "bg-[var(--hl-panel)] text-[var(--hl-ink)] shadow-[inset_2px_0_0_0_var(--hl-accent)]"
                  : "text-slate-500 hover:bg-[var(--hl-raised)] hover:text-[var(--hl-ink)]",
              )}
              onClick={() => {
                if (tab.id === activeId && inspectorOpen) {
                  toggleInspector();
                  return;
                }
                if (!inspectorOpen) setInspectorOpen(true);
                onChange(tab.id);
              }}
            >
              <TabIcon id={tab.id} />
              <span className="sr-only">{tab.label}</span>
              {tab.badge != null && tab.badge !== "" && tab.badge !== 0 ? (
                <span
                  className={cn(
                    "absolute right-0.5 top-1 min-w-[14px] rounded px-0.5 text-center text-[12px] font-bold leading-[14px]",
                    active
                      ? "bg-[var(--hl-ink)] text-[var(--hl-panel)]"
                      : "bg-slate-400 text-white",
                  )}
                >
                  {tab.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>
      {inspectorOpen ? (
        <div className="hl-group flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div
            className={cn(
              "min-w-0 flex-1",
              activeId === "project"
                ? "flex flex-col overflow-hidden"
                : "overflow-x-hidden overflow-y-auto px-3 pt-3",
            )}
          >
            <div
              className={
                activeId === "project" ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "space-y-4 pb-3"
              }
            >
              {children}
            </div>
          </div>
          {footer ? (
            <div className="shrink-0 border-t border-[var(--hl-line)] px-3 py-3">{footer}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
