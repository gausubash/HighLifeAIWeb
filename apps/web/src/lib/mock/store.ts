"use client";

import type {
  Analysis,
  AnalysisResult,
  Project,
  UpdateProjectInput,
} from "@highlife/shared-types";
import type { ScaleInfo } from "@/lib/scale/parseScale";
import { deleteAnalysisPageImages } from "@/lib/pdf/pageImageStore";

const STORAGE_KEY = "highlife-project-store";
const LOCAL_OWNER = "local-user";

interface PersistedState {
  projects: Project[];
  analyses: Analysis[];
  results: Record<string, AnalysisResult>;
  scaleInfos: Record<string, ScaleInfo>;
}

function loadState(): PersistedState {
  if (typeof window === "undefined") {
    return { projects: [], analyses: [], results: {}, scaleInfos: {} };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { projects: [], analyses: [], results: {}, scaleInfos: {} };
    const parsed = JSON.parse(raw) as PersistedState;
    return {
      projects: parsed.projects ?? [],
      analyses: parsed.analyses ?? [],
      results: parsed.results ?? {},
      scaleInfos: parsed.scaleInfos ?? {},
    };
  } catch {
    return { projects: [], analyses: [], results: {}, scaleInfos: {} };
  }
}

class ProjectStore {
  private projects: Project[] = [];
  private analyses: Analysis[] = [];
  private results: Map<string, AnalysisResult> = new Map();
  private scaleInfos: Map<string, ScaleInfo> = new Map();
  private listeners = new Set<() => void>();
  private hydrated = false;

  private hydrate(): void {
    if (this.hydrated || typeof window === "undefined") return;
    const state = loadState();
    this.projects = state.projects;
    this.analyses = state.analyses;
    this.results = new Map(Object.entries(state.results));
    this.scaleInfos = new Map(Object.entries(state.scaleInfos));
    this.hydrated = true;
  }

  private persist(): void {
    if (typeof window === "undefined") return;
    const payload: PersistedState = {
      projects: this.projects,
      analyses: this.analyses,
      results: Object.fromEntries(this.results),
      scaleInfos: Object.fromEntries(this.scaleInfos),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  subscribe(listener: () => void): () => void {
    this.hydrate();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    this.persist();
    for (const listener of this.listeners) {
      listener();
    }
  }

  listProjects(): Project[] {
    this.hydrate();
    return [...this.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  getProject(id: string): Project | undefined {
    this.hydrate();
    return this.projects.find((p) => p.id === id);
  }

  createProject(input: Omit<Project, "id" | "ownerId" | "createdAt" | "updatedAt">): Project {
    this.hydrate();
    const now = new Date().toISOString();
    const project: Project = {
      id: `proj-${Date.now()}`,
      ownerId: LOCAL_OWNER,
      createdAt: now,
      updatedAt: now,
      ...input,
    };
    this.projects.unshift(project);
    this.emit();
    return project;
  }

  updateProject(id: string, input: UpdateProjectInput): Project | undefined {
    this.hydrate();
    const index = this.projects.findIndex((p) => p.id === id);
    if (index === -1) return undefined;

    const current = this.projects[index];
    const updated: Project = {
      ...current,
      ...input,
      updatedAt: new Date().toISOString(),
    };
    this.projects[index] = updated;
    this.emit();
    return updated;
  }

  deleteProject(id: string): boolean {
    this.hydrate();
    const before = this.projects.length;
    this.projects = this.projects.filter((p) => p.id !== id);
    if (this.projects.length === before) return false;

    const analysisIds = this.analyses.filter((a) => a.projectId === id).map((a) => a.id);
    this.analyses = this.analyses.filter((a) => a.projectId !== id);
    for (const analysisId of analysisIds) {
      this.results.delete(analysisId);
      this.scaleInfos.delete(analysisId);
    }

    this.emit();
    void Promise.all(analysisIds.map((aid) => deleteAnalysisPageImages(aid)));
    return true;
  }

  listAnalyses(projectId: string): Analysis[] {
    this.hydrate();
    return this.analyses
      .filter((a) => a.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getAnalysis(id: string): Analysis | undefined {
    this.hydrate();
    return this.analyses.find((a) => a.id === id);
  }

  getResult(analysisId: string): AnalysisResult | undefined {
    this.hydrate();
    return this.results.get(analysisId);
  }

  createAnalysis(projectId: string, fileName: string): Analysis {
    this.hydrate();
    const analysis: Analysis = {
      id: `analysis-${Date.now()}`,
      projectId,
      ownerId: LOCAL_OWNER,
      sourceFileName: fileName,
      status: "queued",
      progress: 0,
      currentStage: "queued",
      createdAt: new Date().toISOString(),
    };
    this.analyses.unshift(analysis);

    const projectIndex = this.projects.findIndex((p) => p.id === projectId);
    if (projectIndex !== -1) {
      this.projects[projectIndex] = {
        ...this.projects[projectIndex],
        updatedAt: new Date().toISOString(),
      };
    }

    this.emit();
    return analysis;
  }

  updateAnalysis(id: string, patch: Partial<Analysis>): Analysis | undefined {
    this.hydrate();
    const index = this.analyses.findIndex((a) => a.id === id);
    if (index === -1) return undefined;
    this.analyses[index] = { ...this.analyses[index], ...patch };
    this.emit();
    return this.analyses[index];
  }

  deleteAnalysis(id: string): boolean {
    this.hydrate();
    const before = this.analyses.length;
    this.analyses = this.analyses.filter((a) => a.id !== id);
    if (this.analyses.length === before) return false;
    this.results.delete(id);
    this.scaleInfos.delete(id);
    this.emit();
    // Fire-and-forget: page rasters live in IndexedDB
    void deleteAnalysisPageImages(id);
    return true;
  }

  setResult(analysisId: string, result: AnalysisResult): void {
    this.hydrate();
    this.results.set(analysisId, result);
    this.emit();
  }

  setScaleInfo(analysisId: string, info: ScaleInfo): void {
    this.hydrate();
    this.scaleInfos.set(analysisId, info);
    this.emit();
  }

  getScaleInfo(analysisId: string): ScaleInfo | undefined {
    this.hydrate();
    return this.scaleInfos.get(analysisId);
  }
}

export const projectStore = new ProjectStore();
