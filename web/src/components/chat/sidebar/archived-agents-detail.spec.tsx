import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectSummary } from '@/lib/projects-api';
import { ArchivedAgentsDetail } from './archived-agents-detail';

const project: ProjectSummary = {
  id: 'project-1',
  name: 'Website redesign',
  workspacePath: '/workspaces/project-1',
  createdAt: 1,
  updatedAt: 1,
  workspaces: [],
  resources: [],
  agentThreads: [
    {
      threadId: 'agent-1',
      workspacePath: '/workspaces/project-1/frontend',
      activeFolder: null,
      title: 'Prepare navigation',
      archived: true,
      taskId: 'task-1',
      taskResourceId: 'board-1',
      taskTitle: 'Mobile navigation',
      isSubtask: true,
    },
    {
      threadId: 'agent-2',
      workspacePath: '/workspaces/project-1/backend',
      activeFolder: null,
      title: 'Audit permissions',
      archived: true,
      taskId: null,
      taskResourceId: null,
      taskTitle: null,
      isSubtask: false,
    },
    {
      threadId: 'active-agent',
      workspacePath: '/workspaces/project-1/frontend',
      activeFolder: null,
      title: 'Still active',
      archived: false,
      taskId: null,
      taskResourceId: null,
      taskTitle: null,
      isSubtask: false,
    },
  ],
};

describe('ArchivedAgentsDetail', () => {
  it('searches and filters only archived project agents', async () => {
    const user = userEvent.setup();
    render(
      <ArchivedAgentsDetail
        project={project}
        pending={false}
        onBack={vi.fn()}
        onOpen={vi.fn()}
        onRestore={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('Prepare navigation')).toBeInTheDocument();
    expect(screen.getByText('Audit permissions')).toBeInTheDocument();
    expect(screen.queryByText('Still active')).not.toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText('Search archived conversations'),
      'permissions',
    );
    expect(screen.queryByText('Prepare navigation')).not.toBeInTheDocument();
    expect(screen.getByText('Audit permissions')).toBeInTheDocument();

    await user.clear(
      screen.getByPlaceholderText('Search archived conversations'),
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'All task associations' }),
      'linked',
    );
    expect(screen.getByText('Prepare navigation')).toBeInTheDocument();
    expect(screen.queryByText('Audit permissions')).not.toBeInTheDocument();
  });

  it('opens, restores, and proposes separate permanent deletion', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const restore = vi.fn();
    const remove = vi.fn();
    render(
      <ArchivedAgentsDetail
        project={project}
        pending={false}
        onBack={vi.fn()}
        onOpen={open}
        onRestore={restore}
        onDelete={remove}
      />,
    );

    const row = screen
      .getByText('Prepare navigation')
      .closest<HTMLElement>('div.group')!;
    await user.click(within(row).getByText('Prepare navigation'));
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'agent-1' }),
    );
    await user.click(within(row).getByRole('button', { name: 'Restore' }));
    expect(restore).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'agent-1' }),
    );
    await user.click(
      within(row).getByRole('button', { name: 'Delete permanently' }),
    );
    expect(remove).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'agent-1' }),
    );
  });
});
