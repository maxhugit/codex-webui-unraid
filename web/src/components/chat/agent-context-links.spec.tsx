import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentContextLinks } from './agent-context-links';
import type { ProjectSummary } from '@/lib/projects-api';
const api = vi.hoisted(() => vi.fn());
vi.mock('@/lib/projects-api', () => ({ projectsApi: api }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: globalThis.__testTranslate }),
}));
vi.mock('@/components/projects/project-task-manager', () => ({
  ProjectTaskManager: ({
    initialTaskId,
    onModalClose,
  }: {
    initialTaskId: string;
    onModalClose: () => void;
  }) => (
    <div role="dialog" aria-label={initialTaskId}>
      <button onClick={onModalClose}>Close task</button>
    </div>
  ),
}));
afterEach(() => {
  cleanup();
  api.mockReset();
});
const project = {
  id: 'p',
  resources: [{ id: 'board', type: 'deliverable_board' }],
  agentThreads: [
    {
      threadId: 'agent',
      taskId: 'task',
      taskResourceId: 'tasks',
      taskTitle: 'Write report',
    },
  ],
} as ProjectSummary;
function show(props: Partial<Parameters<typeof AgentContextLinks>[0]> = {}) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AgentContextLinks
        threadId="agent"
        project={project}
        loading={false}
        failed={false}
        {...props}
      />
    </QueryClientProvider>,
  );
}
it('opens the exact deliverable and the assigned task in a modal without duplicate tasks', async () => {
  api.mockResolvedValue({
    tasks: [{ id: 'task', resourceId: 'tasks', title: 'Write report' }],
    deliverables: [
      {
        id: 'report',
        title: 'Design report',
        primaryTaskId: 'task',
        conversations: [],
      },
    ],
  });
  show();
  expect(
    await screen.findByRole('link', { name: 'Design report' }),
  ).toHaveAttribute('href', '/projects/p/resources/board?deliverable=report');
  expect(screen.getAllByRole('button')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /Write report/ }));
  expect(
    await screen.findByRole('dialog', { name: 'task' }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByText('Close task'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('distinguishes the deliverable task when an agent is linked directly to its deliverable', async () => {
  api.mockResolvedValue({
    tasks: [{ id: 'parent', resourceId: 'tasks', title: 'Main task' }],
    deliverables: [
      {
        id: 'report',
        title: 'Report',
        primaryTaskId: 'parent',
        conversations: [{ type: 'agent', id: 'agent' }],
      },
    ],
  });
  show({ project: { ...project, agentThreads: [] } });
  expect(
    await screen.findByRole('button', { name: /Deliverable task: Main task/ }),
  ).toBeInTheDocument();
});
it('recognizes the parent deliverable of an assigned subtask', async () => {
  api.mockResolvedValue({
    tasks: [
      {
        id: 'task',
        resourceId: 'tasks',
        title: 'Write report',
        parentTaskId: 'parent',
      },
      { id: 'parent', resourceId: 'tasks', title: 'Main task' },
    ],
    deliverables: [
      {
        id: 'report',
        title: 'Report',
        primaryTaskId: 'parent',
        conversations: [],
      },
    ],
  });
  show();
  expect(
    await screen.findByRole('link', { name: 'Report' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: /Deliverable task: Main task/ }),
  ).toBeInTheDocument();
});
it('shows an empty state without fetching a board for a projectless agent', () => {
  show({ project: undefined });
  expect(screen.getByText('No linked deliverable or task')).toBeInTheDocument();
  expect(api).not.toHaveBeenCalled();
});
it('does not claim no relationships while loading or on access failure', async () => {
  api.mockRejectedValue(new Error('Forbidden'));
  show({ project: { ...project, agentThreads: [] } });
  expect(
    screen.queryByText('No linked deliverable or task'),
  ).not.toBeInTheDocument();
  expect(await screen.findByRole('alert')).toBeInTheDocument();
  expect(
    screen.queryByText('No linked deliverable or task'),
  ).not.toBeInTheDocument();
});
