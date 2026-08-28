"use client";

import { useEffect, useState } from "react";
import { projectStore } from "@/lib/data/projectStore";
import type { Analysis, AnalysisResult, Project } from "@highlife/shared-types";
import type { ScaleInfo } from "@/lib/scale/parseScale";

/**
 * True after the first client mount. Ensures SSR and first client paint both
 * see empty store data; Supabase hydrate runs in AuthProvider before the workspace.
 */
export function useStoreReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  return ready;
}

export function useProjects() {
  const ready = useStoreReady();
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (!ready) return;
    setProjects(projectStore.listProjects());
    return projectStore.subscribe(() => {
      setProjects(projectStore.listProjects());
    });
  }, [ready]);

  return { projects, ready };
}

export function useProject(projectId: string | undefined) {
  const ready = useStoreReady();
  const [project, setProject] = useState<Project | undefined>(undefined);

  useEffect(() => {
    if (!ready || !projectId) {
      setProject(undefined);
      return;
    }
    setProject(projectStore.getProject(projectId));
    return projectStore.subscribe(() => {
      setProject(projectStore.getProject(projectId));
    });
  }, [ready, projectId]);

  return { project, ready };
}

export function useAnalyses(projectId: string | undefined) {
  const ready = useStoreReady();
  const [analyses, setAnalyses] = useState<Analysis[]>([]);

  useEffect(() => {
    if (!ready || !projectId) {
      setAnalyses([]);
      return;
    }
    setAnalyses(projectStore.listAnalyses(projectId));
    return projectStore.subscribe(() => {
      setAnalyses(projectStore.listAnalyses(projectId));
    });
  }, [ready, projectId]);

  return { analyses, ready };
}

export function useAnalysisBundle(analysisId: string | undefined) {
  const ready = useStoreReady();
  const [analysis, setAnalysis] = useState<Analysis | undefined>(undefined);
  const [result, setResult] = useState<AnalysisResult | undefined>(undefined);
  const [scaleInfo, setScaleInfo] = useState<ScaleInfo | undefined>(undefined);

  useEffect(() => {
    if (!ready || !analysisId) {
      setAnalysis(undefined);
      setResult(undefined);
      setScaleInfo(undefined);
      return;
    }
    const sync = () => {
      setAnalysis(projectStore.getAnalysis(analysisId));
      setResult(projectStore.getResult(analysisId));
      setScaleInfo(projectStore.getScaleInfo(analysisId));
    };
    sync();
    return projectStore.subscribe(sync);
  }, [ready, analysisId]);

  return { analysis, result, scaleInfo, ready };
}
