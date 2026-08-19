import type {
  Analysis,
  AnalysisResult,
  Project,
} from "@highlife/shared-types";
import { mockAnalysisResult } from "./result";

const MOCK_OWNER = "mock-user-001";

export const MOCK_PROJECTS: Project[] = [
  {
    id: "proj-001",
    ownerId: MOCK_OWNER,
    name: "Sunset Apartments — Tower A",
    description: "Multi-unit residential review, levels 1–3",
    jurisdiction: "victoria",
    policyVersion: "draft-v1",
    createdAt: "2026-08-01T09:00:00.000Z",
    updatedAt: "2026-08-15T14:30:00.000Z",
  },
  {
    id: "proj-002",
    ownerId: MOCK_OWNER,
    name: "Harbour View — Block B",
    description: "Two-bedroom mix assessment",
    jurisdiction: "victoria",
    policyVersion: "draft-v1",
    createdAt: "2026-08-10T11:00:00.000Z",
    updatedAt: "2026-08-10T11:00:00.000Z",
  },
];

export const MOCK_ANALYSES: Analysis[] = [
  {
    id: "analysis-001",
    projectId: "proj-001",
    ownerId: MOCK_OWNER,
    sourceFileName: "tower_a_level_2.pdf",
    status: "review_required",
    progress: 100,
    currentStage: "review_required",
    pageCount: 1,
    unitCount: 2,
    reviewCount: 1,
    modelVersions: { structural: "0.0.0-mock", spatial: "0.0.0-mock" },
    softwareCommit: "mock-local",
    createdAt: "2026-08-15T10:00:00.000Z",
    startedAt: "2026-08-15T10:00:05.000Z",
    completedAt: "2026-08-15T10:01:30.000Z",
  },
  {
    id: "analysis-002",
    projectId: "proj-001",
    ownerId: MOCK_OWNER,
    sourceFileName: "tower_a_level_1.pdf",
    status: "completed",
    progress: 100,
    currentStage: "completed",
    pageCount: 1,
    unitCount: 2,
    reviewCount: 0,
    createdAt: "2026-08-01T09:30:00.000Z",
    completedAt: "2026-08-01T09:32:00.000Z",
  },
];

/** In-memory store for mock mode (Phase 2). Replaced by Supabase in Phase 3. */
class MockStore {
  private projects: Project[] = [...MOCK_PROJECTS];
  private analyses: Analysis[] = [...MOCK_ANALYSES];
  private results: Map<string, AnalysisResult> = new Map([
    ["analysis-001", mockAnalysisResult],
    ["analysis-002", { ...mockAnalysisResult, analysisId: "analysis-002", status: "completed", currentStage: "completed" }],
  ]);

  listProjects(): Project[] {
    return [...this.projects];
  }

  getProject(id: string): Project | undefined {
    return this.projects.find((p) => p.id === id);
  }

  createProject(input: Omit<Project, "id" | "ownerId" | "createdAt" | "updatedAt">): Project {
    const now = new Date().toISOString();
    const project: Project = {
      id: `proj-${Date.now()}`,
      ownerId: MOCK_OWNER,
      createdAt: now,
      updatedAt: now,
      ...input,
    };
    this.projects.unshift(project);
    return project;
  }

  listAnalyses(projectId: string): Analysis[] {
    return this.analyses
      .filter((a) => a.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getAnalysis(id: string): Analysis | undefined {
    return this.analyses.find((a) => a.id === id);
  }

  getResult(analysisId: string): AnalysisResult | undefined {
    return this.results.get(analysisId);
  }

  createAnalysis(projectId: string, fileName: string): Analysis {
    const analysis: Analysis = {
      id: `analysis-${Date.now()}`,
      projectId,
      ownerId: MOCK_OWNER,
      sourceFileName: fileName,
      status: "queued",
      progress: 0,
      currentStage: "queued",
      createdAt: new Date().toISOString(),
    };
    this.analyses.unshift(analysis);
    return analysis;
  }

  updateAnalysis(id: string, patch: Partial<Analysis>): Analysis | undefined {
    const index = this.analyses.findIndex((a) => a.id === id);
    if (index === -1) return undefined;
    this.analyses[index] = { ...this.analyses[index], ...patch };
    return this.analyses[index];
  }

  setResult(analysisId: string, result: AnalysisResult): void {
    this.results.set(analysisId, result);
  }
}

export const mockStore = new MockStore();
