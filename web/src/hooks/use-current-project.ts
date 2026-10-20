import { useQuery } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import {
  projectForWorkspace,
  projectsApi,
  projectsQueryKey,
  type ProjectSummary,
} from '@/lib/projects-api';
import { useTimelineStore } from '@/stores/timeline-store';

/** Returns the project owning the workspace of the visible Codex conversation. */
export function useCurrentProject(): ProjectSummary | undefined {
  const visible = useRouterState({
    select: (state) => state.location.pathname.startsWith('/t/'),
  });
  const cwd = useTimelineStore((state) => state.threadCwd);
  const projects = useQuery({
    queryKey: projectsQueryKey,
    queryFn: () => projectsApi<{ projects: ProjectSummary[] }>(),
    enabled: visible,
  });
  return visible
    ? projectForWorkspace(projects.data?.projects, cwd ?? null)
    : undefined;
}
