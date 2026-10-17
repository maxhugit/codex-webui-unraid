import { useParams, useSearch } from '@tanstack/react-router';
import { ProjectTaskManager } from '@/components/projects/project-task-manager';

export function ProjectResourceRoute() {
  const { projectId, resourceId } = useParams({ strict: false }) as {
    projectId: string;
    resourceId: string;
  };
  const { task } = useSearch({ strict: false }) as { task?: string };
  return (
    <ProjectTaskManager
      projectId={projectId}
      resourceId={resourceId}
      initialTaskId={task}
    />
  );
}
