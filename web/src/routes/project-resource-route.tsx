import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ProjectTaskManager } from '@/components/projects/project-task-manager';
import { ProjectDeliverablesManager } from '@/components/projects/project-deliverables-manager';
import { ProjectAutomationManager } from '@/components/projects/project-automation-manager';
import {
  projectsApi,
  projectsQueryKey,
  type ProjectSummary,
} from '@/lib/projects-api';

export function ProjectResourceRoute() {
  const { projectId, resourceId } = useParams({ strict: false }) as {
    projectId: string;
    resourceId: string;
  };
  const { task, deliverable } = useSearch({ strict: false }) as {
    task?: string;
    deliverable?: string;
  };
  const navigate = useNavigate();
  const projects = useQuery({
    queryKey: projectsQueryKey,
    queryFn: () => projectsApi<{ projects: ProjectSummary[] }>(),
  });
  const resource = projects.data?.projects
    .find((project) => project.id === projectId)
    ?.resources.find((item) => item.id === resourceId);
  if (!resource)
    return <div className="p-6 text-sm text-muted-foreground">Chargement…</div>;
  if (resource.type === 'automation_board')
    return (
      <ProjectAutomationManager projectId={projectId} resourceId={resourceId} />
    );
  if (resource.type === 'deliverable_board')
    return (
      <ProjectDeliverablesManager
        key={`${projectId}:${resourceId}:${deliverable ?? ''}`}
        projectId={projectId}
        resourceId={resourceId}
        initialDeliverableId={deliverable}
        onBackToList={() =>
          void navigate({
            to: '/projects/$projectId/resources/$resourceId',
            params: { projectId, resourceId },
            search: {},
          })
        }
      />
    );
  return (
    <ProjectTaskManager
      projectId={projectId}
      resourceId={resourceId}
      initialTaskId={task}
    />
  );
}
