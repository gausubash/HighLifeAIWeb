import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ projectId: string; analysisId: string }>;
}

export default async function ReviewPage({ params }: PageProps) {
  const { projectId, analysisId } = await params;
  redirect(`/projects/${projectId}/analyses/${analysisId}?tab=review`);
}
