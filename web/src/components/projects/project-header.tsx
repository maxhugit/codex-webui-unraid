import { useQuery } from '@tanstack/react-query';
import { FolderKanban } from 'lucide-react';
import {
  projectsApi,
  projectsQueryKey,
  type ProjectSummary,
} from '@/lib/projects-api';

export function ProjectHeader({ projectId }: { projectId: string }) {
  const projects = useQuery({
    queryKey: projectsQueryKey,
    queryFn: () => projectsApi<{ projects: ProjectSummary[] }>(),
  });
  const project = projects.data?.projects.find((item) => item.id === projectId);

  return (
    <div className="flex min-w-0 items-center gap-2">
      <FolderKanban
        aria-hidden="true"
        className="h-5 w-5 shrink-0 text-primary"
      />
      <h1
        className="truncate text-sm font-semibold tracking-tight sm:text-base"
        title={project?.name}
      >
        {project?.name ?? 'Mergeron'}
      </h1>
    </div>
  );
}
