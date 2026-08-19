"use client";

import { useCallback, useEffect, useState } from "react";
import type { Analysis } from "@highlife/shared-types";
import { mockStore } from "@/lib/mock/store";
import { mockAnalysisResult } from "@/lib/mock/result";
import { nextStage, stageProgress } from "@/lib/mock/stages";

const STAGE_INTERVAL_MS = 800;

interface UseAnalysisProgressOptions {
  analysisId: string;
  enabled?: boolean;
}

/**
 * Simulates GPU worker stage progression in mock mode.
 * Phase 3 replaces this with Supabase Realtime subscriptions.
 */
export function useAnalysisProgress({
  analysisId,
  enabled = true,
}: UseAnalysisProgressOptions) {
  const [analysis, setAnalysis] = useState<Analysis | undefined>(() =>
    mockStore.getAnalysis(analysisId)
  );

  const refresh = useCallback(() => {
    setAnalysis(mockStore.getAnalysis(analysisId));
  }, [analysisId]);

  useEffect(() => {
    if (!enabled || !analysis) return;
    if (
      analysis.status === "review_required" ||
      analysis.status === "completed" ||
      analysis.status === "failed" ||
      analysis.status === "cancelled"
    ) {
      return;
    }

    if (analysis.status === "queued") {
      mockStore.updateAnalysis(analysisId, {
        status: "processing",
        currentStage: "rendering_pdf",
        progress: stageProgress("rendering_pdf"),
        startedAt: new Date().toISOString(),
      });
      refresh();
      return;
    }

    const timer = window.setInterval(() => {
      const current = mockStore.getAnalysis(analysisId);
      if (!current || current.status !== "processing") return;

      const upcoming = nextStage(current.currentStage);
      if (upcoming === "review_required") {
        mockStore.updateAnalysis(analysisId, {
          status: "review_required",
          currentStage: "review_required",
          progress: 100,
          pageCount: 1,
          unitCount: mockAnalysisResult.units.length,
          reviewCount: mockAnalysisResult.reviewWarnings.length,
          completedAt: new Date().toISOString(),
        });
        mockStore.setResult(analysisId, {
          ...mockAnalysisResult,
          analysisId,
        });
        refresh();
        window.clearInterval(timer);
        return;
      }

      mockStore.updateAnalysis(analysisId, {
        currentStage: upcoming,
        progress: stageProgress(upcoming),
      });
      refresh();
    }, STAGE_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [analysis, analysisId, enabled, refresh]);

  return { analysis, refresh };
}
