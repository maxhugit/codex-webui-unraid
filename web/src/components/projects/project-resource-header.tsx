import { useQuery } from '@tanstack/react-query';
import { ListTodo } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { projectsApi, type ProjectTaskBoard } from '@/lib/projects-api';
import { countOpenBoardActions } from '@/lib/task-board-summary';

/** Shares the board query with the page, so edits update the header immediately. */
export function ProjectResourceHeader({
  projectId,
  resourceId,
}: {
  projectId: string;
  resourceId: string;
}) {
  const { t } = useTranslation();
  const { data: board } = useQuery({
    queryKey: ['project-resource', projectId, resourceId],
    queryFn: () =>
      projectsApi<ProjectTaskBoard>(`/${projectId}/resources/${resourceId}`),
  });
  if (!board || board.resource.type !== 'task_board') {
    return (
      <h1 className="text-lg font-semibold tracking-tight">Codex WebUI</h1>
    );
  }
  const count = countOpenBoardActions(board);
  return (
    <div className="flex min-w-0 items-center gap-2">
      <ListTodo aria-hidden="true" className="h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0">
        <h1
          className="truncate text-sm font-semibold leading-tight tracking-tight sm:text-base"
          title={board.resource.name}
        >
          {board.resource.name}
        </h1>
        <p className="truncate text-xs leading-tight text-muted-foreground">
          {t(count === 1 ? '{{count}} open action' : '{{count}} open actions', {
            count,
          })}
        </p>
      </div>
    </div>
  );
}
