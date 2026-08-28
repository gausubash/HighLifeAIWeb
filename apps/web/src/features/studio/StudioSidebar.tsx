"use client";

import Link from "next/link";
import { StudioTabBar, type StudioTabId } from "./StudioTabBar";

interface StudioSidebarProps {
  active: StudioTabId;
  onChange: (tab: StudioTabId) => void;
}

/** Model Studio nav — separate from the project / floor-plan analysis sidebar. */
export function StudioSidebar({ active, onChange }: StudioSidebarProps) {
  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-3 py-2.5">
        <p className="font-display text-sm font-semibold text-brand-800">Model Studio</p>
        <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
          Label, fine-tune, and test detectors. Separate from project floor-plan analysis.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        <StudioTabBar active={active} onChange={onChange} orientation="vertical" />
      </div>

      <div className="border-t border-slate-200 px-2 py-2">
        <Link
          href="/projects"
          className="block rounded px-2 py-1.5 text-[11px] text-slate-600 hover:bg-slate-50 hover:text-slate-900"
        >
          ← Projects
        </Link>
      </div>
    </aside>
  );
}
