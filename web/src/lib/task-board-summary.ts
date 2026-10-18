import type { ProjectTaskBoard } from './projects-api';

/** Count all open actions, including subtasks, independently of board filters. */
export function countOpenBoardActions(board: ProjectTaskBoard): number {
  const raw = board.resource.config.taskBoardSettings;
  const settings =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as { terminalStatusIds?: unknown })
      : {};
  const terminalIds = new Set(
    Array.isArray(settings.terminalStatusIds)
      ? settings.terminalStatusIds.filter(
          (id): id is string => typeof id === 'string',
        )
      : board.statuses
          .filter((status) => status.kind === 'done')
          .map((status) => status.id),
  );
  return board.tasks.filter((task) =>
    task.parentTaskId
      ? task.subtaskStatus !== 'done' && task.subtaskStatus !== 'cancelled'
      : !terminalIds.has(task.statusId),
  ).length;
}
