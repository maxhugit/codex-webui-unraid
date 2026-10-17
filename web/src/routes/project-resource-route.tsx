import { useParams } from '@tanstack/react-router';
import { ProjectTaskManager } from '@/components/projects/project-task-manager';

export function ProjectResourceRoute() {
  const { projectId, resourceId } = useParams({ strict: false }) as {
    projectId: string;
    resourceId: string;
  };
  return <ProjectTaskManager projectId={projectId} resourceId={resourceId} />;
}
