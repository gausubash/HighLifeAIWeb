"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { projectStore } from "@/lib/data/projectStore";

const CRUMB_MAX = 12;

function shortenLabel(label: string): string {
  if (label.length <= CRUMB_MAX) return label;
  return `${label.slice(0, CRUMB_MAX)}…`;
}

function buildBreadcrumbs(
  pathname: string,
  search = "",
): { label: string; href?: string }[] {
  const crumbs: { label: string; href?: string }[] = [];
  if (pathname.startsWith("/studio")) {
    return [{ label: "Model Studio", href: "/studio" }];
  }
  if (pathname.startsWith("/docs")) {
    return [{ label: "Detection & ML reference", href: "/docs" }];
  }
  crumbs.push({ label: "Projects", href: "/projects" });

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
    if (pathname.endsWith("/review") || new URLSearchParams(search).get("tab") === "review") {
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

  useEffect(() => {
    const sync = () => setCrumbs(buildBreadcrumbs(pathname, window.location.search));
    sync();
    return projectStore.subscribe(sync);
  }, [pathname]);

  return (
    <nav
      className="flex min-w-0 items-center gap-1 text-xs text-slate-500"
      aria-label="Breadcrumb"
    >
      {crumbs.map((crumb, index) => (
        <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1">
          {index > 0 && <span className="text-slate-300">/</span>}
          {crumb.href && index < crumbs.length - 1 ? (
            <Link
              href={crumb.href}
              title={crumb.label}
              className="shrink-0 hover:text-brand-600"
            >
              {shortenLabel(crumb.label)}
            </Link>
          ) : (
            <span
              title={crumb.label}
              className="shrink-0 font-medium text-slate-700"
            >
              {shortenLabel(crumb.label)}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
