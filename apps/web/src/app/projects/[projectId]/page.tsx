import { ProjectDashboardClient } from "@/features/projects/ProjectDashboardClient";

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProjectPage({ params }: PageProps) {
  const { projectId } = await params;
  return <ProjectDashboardClient projectId={projectId} />;
}
