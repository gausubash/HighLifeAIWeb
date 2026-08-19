import { AnalysisPageClient } from "@/features/analyses/AnalysisPageClient";

interface PageProps {
  params: Promise<{ projectId: string; analysisId: string }>;
}

export default async function AnalysisPage({ params }: PageProps) {
  const { projectId, analysisId } = await params;
  return <AnalysisPageClient projectId={projectId} analysisId={analysisId} />;
}
