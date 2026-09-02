"use client";

import Link from "next/link";
import type { SVGProps } from "react";
import { cn } from "@/lib/utils";
import { STUDIO_TABS, type StudioTabId } from "./StudioTabBar";

interface StudioActivityRailProps {
  active: StudioTabId;
  onChange: (tab: StudioTabId) => void;
}

function TabIcon({ id, ...props }: SVGProps<SVGSVGElement> & { id: StudioTabId }) {
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
    case "datasets":
      return (
        <svg {...common} aria-hidden>
          <path d="M4 7h16v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7z" />
          <path d="M4 7V5a1 1 0 0 1 1-1h5l2 2h7a1 1 0 0 1 1 1v0" />
          <path d="M8 13h8M8 17h5" />
        </svg>
      );
    case "annotate":
      return (
        <svg {...common} aria-hidden>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      );
    case "tiles":
      return (
        <svg {...common} aria-hidden>
          <rect x="3" y="3" width="8" height="8" rx="1" />
          <rect x="13" y="3" width="8" height="8" rx="1" />
          <rect x="3" y="13" width="8" height="8" rx="1" />
          <rect x="13" y="13" width="8" height="8" rx="1" />
        </svg>
      );
    case "train":
      return (
        <svg {...common} aria-hidden>
          <path d="M12 3v4" />
          <path d="M8 7h8" />
          <rect x="5" y="9" width="14" height="10" rx="2" />
          <path d="M9 13h6M9 16h4" />
        </svg>
      );
    case "models":
      return (
        <svg {...common} aria-hidden>
          <path d="M12 3 4 7v10l8 4 8-4V7l-8-4z" />
          <path d="M4 7l8 4 8-4M12 11v10" />
        </svg>
      );
    case "infer":
      return (
        <svg {...common} aria-hidden>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="10" cy="11" r="2.5" />
          <path d="M21 16l-5-5-3 3-2-2-4 4" />
        </svg>
      );
    default:
      return null;
  }
}

/** Model Studio left activity bar — icon-only navigation, no project explorer. */
export function StudioActivityRail({ active, onChange }: StudioActivityRailProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--hl-chrome)]">
      <nav
        className="hl-activity-bar flex min-h-0 flex-1 flex-col items-stretch overflow-y-auto overscroll-none"
        aria-label="Model Studio"
      >
        {STUDIO_TABS.map((tab) => {
          const selected = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              title={`${tab.label} — ${tab.hint}`}
              aria-current={selected ? "page" : undefined}
              className={cn(
                "relative flex h-11 w-11 shrink-0 items-center justify-center transition-colors",
                selected
                  ? "bg-[var(--hl-panel)] text-[var(--hl-ink)] shadow-[inset_2px_0_0_0_var(--hl-accent)]"
                  : "text-slate-500 hover:bg-[var(--hl-raised)] hover:text-[var(--hl-ink)]",
              )}
              onClick={() => onChange(tab.id)}
            >
              <TabIcon id={tab.id} />
              <span className="sr-only">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-[var(--hl-line)] p-1">
        <Link
          href="/projects"
          title="Back to projects"
          className="flex h-9 w-11 items-center justify-center rounded text-slate-500 transition-colors hover:bg-[var(--hl-raised)] hover:text-[var(--hl-ink)]"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="sr-only">Projects</span>
        </Link>
      </div>
    </div>
  );
}
