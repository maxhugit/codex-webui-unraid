import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectResourceHeader } from './project-resource-header';
import { countOpenBoardActions } from '@/lib/task-board-summary';
import type { ProjectTaskBoard } from '@/lib/projects-api';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: globalThis.__testTranslate,
  }),
}));
afterEach(cleanup);
const task = (
  id: string,
  statusId: string,
  parentTaskId: string | null = null,
  subtaskStatus = 'todo',
) =>
  ({
    id,
    statusId,
    parentTaskId,
    subtaskStatus,
  }) as ProjectTaskBoard['tasks'][number];
function board(): ProjectTaskBoard {
  return {
    resource: {
      name: 'Gestionnaire de tâches',
      type: 'task_board',
      config: {},
    },
    statuses: [
      { id: 'open', kind: 'todo' },
      { id: 'finished', kind: 'done' },
    ],
    tasks: [
      task('parent', 'open'),
      task('finished-parent', 'finished'),
      task('sub', 'open', 'parent'),
      task('cancelled', 'open', 'parent', 'cancelled'),
    ],
  } as ProjectTaskBoard;
}
function setup(data = board()) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(['project-resource', 'project', 'board'], data);
  const view = render(
    <QueryClientProvider client={client}>
      <ProjectResourceHeader projectId="project" resourceId="board" />
    </QueryClientProvider>,
  );
  return { client, view };
}
it('renders the board name and only open actions in the compact header', () => {
  setup();
  expect(
    screen.getByRole('heading', { name: 'Gestionnaire de tâches' }),
  ).toBeInTheDocument();
  expect(screen.getByText('2 open actions')).toBeInTheDocument();
  expect(screen.queryByText('Mergeron')).toBeNull();
});
it('updates immediately from the same query cache used by the task manager', async () => {
  const { client } = setup();
  const updated = board();
  updated.resource.name = 'Nouveau nom';
  updated.tasks[2].subtaskStatus = 'done';
  act(() =>
    client.setQueryData(['project-resource', 'project', 'board'], updated),
  );
  expect(
    await screen.findByRole('heading', { name: 'Nouveau nom' }),
  ).toBeInTheDocument();
  expect(await screen.findByText('1 open action')).toBeInTheDocument();
});
it('keeps the generic header for automation boards', () => {
  const automation = board();
  automation.resource.type = 'automation_board';
  setup(automation);
  expect(
    screen.getByRole('heading', { name: 'Mergeron' }),
  ).toBeInTheDocument();
  expect(screen.queryByText('2 open actions')).toBeNull();
});
it('does not keep the previous board title when switching resources', () => {
  const { client, view } = setup();
  const next = board();
  next.resource.name = 'Autre tableau';
  next.tasks = [];
  client.setQueryData(['project-resource', 'project', 'next-board'], next);
  view.rerender(
    <QueryClientProvider client={client}>
      <ProjectResourceHeader projectId="project" resourceId="next-board" />
    </QueryClientProvider>,
  );
  expect(
    screen.getByRole('heading', { name: 'Autre tableau' }),
  ).toBeInTheDocument();
  expect(screen.getByText('0 open actions')).toBeInTheDocument();
  expect(screen.queryByText('Gestionnaire de tâches')).toBeNull();
});
it('respects configured terminal statuses, including an explicit empty list', () => {
  const data = board();
  data.resource.config.taskBoardSettings = { terminalStatusIds: ['open'] };
  expect(countOpenBoardActions(data)).toBe(2);
  data.resource.config.taskBoardSettings = { terminalStatusIds: [] };
  expect(countOpenBoardActions(data)).toBe(3);
});
it('excludes done and cancelled subtasks but counts ones awaiting validation', () => {
  const data = board();
  data.tasks = [
    task('a', 'open', 'parent', 'done'),
    task('b', 'open', 'parent', 'cancelled'),
    task('c', 'open', 'parent', 'review'),
  ];
  expect(countOpenBoardActions(data)).toBe(1);
});
