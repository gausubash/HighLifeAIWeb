"use client";

import type { Project } from "@highlife/shared-types";
import { Panel } from "@/components/shell/Panel";
import { useLayoutStore } from "@/features/plan-viewer/useLayoutStore";
import { ProjectSettingsPanel } from "./ProjectSettingsPanel";

interface ProjectPropertiesSidebarProps {
  project: Project;
  onDeleted?: () => void;
}

export function ProjectPropertiesSidebar({ project, onDeleted }: ProjectPropertiesSidebarProps) {
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);

  return (
    <div className="hl-panel-stack h-full">
      <div className="hl-group flex min-h-0 flex-1 flex-col overflow-hidden">
        <Panel
          title="Properties"
          className="h-full min-h-0"
          bodyClassName="overflow-y-auto p-0"
          action={
            <button
              type="button"
              className="rounded p-1 text-slate-500 hover:bg-[var(--hl-raised)] hover:text-slate-800"
              onClick={toggleSidebar}
              title="Hide properties panel"
              aria-label="Hide properties panel"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M9 6l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          }
        >
          <ProjectSettingsPanel project={project} onDeleted={onDeleted} />
        </Panel>
      </div>
    </div>
  );
}
