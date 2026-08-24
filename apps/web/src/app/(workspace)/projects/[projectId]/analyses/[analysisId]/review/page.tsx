import { ReviewPageClient } from "@/features/analyses/ReviewPageClient";

interface PageProps {
  params: Promise<{ projectId: string; analysisId: string }>;
}

export default async function ReviewPage({ params }: PageProps) {
  const { projectId, analysisId } = await params;
  return <ReviewPageClient projectId={projectId} analysisId={analysisId} />;
}
