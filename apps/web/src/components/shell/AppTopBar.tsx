"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { projectStore } from "@/lib/mock/store";
import { useLayoutStore } from "@/features/plan-viewer/useLayoutStore";

function buildBreadcrumbs(
  pathname: string
): { label: string; href?: string }[] {
  const crumbs: { label: string; href?: string }[] = [
    { label: "Projects", href: "/projects" },
  ];

  const projectMatch = pathname.match(/^\/projects\/([^/]+)/);
  if (!projectMatch) return crumbs;

  const projectId = projectMatch[1];
  if (projectId === "new") {
    crumbs.push({ label: "New project" });
    return crumbs;
  }

  const project = projectStore.getProject(projectId);
  crumbs.push({
    label: project?.name ?? "Project",
    href: `/projects/${projectId}`,
  });

  const analysisMatch = pathname.match(/^\/projects\/[^/]+\/analyses\/([^/]+)/);
  if (analysisMatch) {
    const analysisId = analysisMatch[1];
    const analysis = projectStore.getAnalysis(analysisId);
    crumbs.push({
      label: analysis?.sourceFileName ?? "Drawing",
      href: `/projects/${projectId}/analyses/${analysisId}`,
    });
    if (pathname.endsWith("/review")) {
      crumbs.push({ label: "Review" });
    }
  }

  return crumbs;
}

export function AppTopBar() {
  const pathname = usePathname();
  const [crumbs, setCrumbs] = useState<{ label: string; href?: string }[]>([
    { label: "Projects", href: "/projects" },
  ]);

  const sidebarOpen = useLayoutStore((s) => s.sidebarOpen);
  const inspectorOpen = useLayoutStore((s) => s.inspectorOpen);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const toggleInspector = useLayoutStore((s) => s.toggleInspector);

  // Breadcrumbs depend on localStorage-backed store — set after mount
  useEffect(() => {
    const sync = () => setCrumbs(buildBreadcrumbs(pathname));
    sync();
    return projectStore.subscribe(sync);
  }, [pathname]);

  return (
    <header className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-2">
      <button
        type="button"
        title={sidebarOpen ? "Hide sidebar (Ctrl+B)" : "Show sidebar (Ctrl+B)"}
        onClick={toggleSidebar}
        className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
      >
        {sidebarOpen ? "◀" : "▶"}
      </button>

      <nav className="flex min-w-0 flex-1 items-center gap-1 text-xs text-slate-500">
        {crumbs.map((crumb, index) => (
          <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
            {index > 0 && <span className="text-slate-300">/</span>}
            {crumb.href && index < crumbs.length - 1 ? (
              <Link href={crumb.href} className="truncate hover:text-brand-600">
                {crumb.label}
              </Link>
            ) : (
              <span className="truncate font-medium text-slate-800">{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>

      <button
        type="button"
        title={inspectorOpen ? "Hide inspector (Ctrl+I)" : "Show inspector (Ctrl+I)"}
        onClick={toggleInspector}
        className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
      >
        {inspectorOpen ? "▶" : "◀"}
      </button>
    </header>
  );
}
