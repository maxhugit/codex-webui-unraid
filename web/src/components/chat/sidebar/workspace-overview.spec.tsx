import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DragDropProvider } from '@dnd-kit/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceOverview } from './workspace-overview';

describe('WorkspaceOverview creation menu', () => {
  it.each([
    ['Work agent', 'agent'],
    ['Simple conversation', 'simple'],
    ['Task manager', 'task'],
  ] as const)('creates a %s in the selected workspace', async (label, kind) => {
    const user = userEvent.setup();
    const createAgent = vi.fn();
    const createSimpleChat = vi.fn();
    const createTaskBoard = vi.fn();

    render(
      <DragDropProvider>
        <WorkspaceOverview
          projectsHeader={<h2>Projects</h2>}
          archivedThreads={[]}
          workspaceGroups={[
            { cwd: '/workspaces/Unraid', threads: [], simpleChats: [] },
          ]}
          collapsedGroups={new Set()}
          isLoading={false}
          onToggleCollapse={vi.fn()}
          onOpenArchivedDetail={vi.fn()}
          onOpenWorkspaceDetail={vi.fn()}
          onCreateAgentInWorkspace={createAgent}
          onCreateSimpleChatInWorkspace={createSimpleChat}
          onCreateTaskBoard={createTaskBoard}
          onOpenResource={vi.fn()}
          resourceActionPending={false}
          onRenameResource={vi.fn()}
          onDeleteResource={vi.fn()}
          renderThreadRow={() => null}
          renderSimpleChatRow={() => null}
          movingThread={false}
        />
      </DragDropProvider>,
    );

    const archive = screen.getByRole('button', { name: 'Archived projects' });
    const projects = screen.getByRole('heading', { name: 'Projects' });
    expect(
      archive.compareDocumentPosition(projects) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(archive).toHaveClass('text-sm', 'font-semibold', 'gap-2');
    expect(archive).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('button', { name: 'Project actions' }));
    expect(screen.getByRole('button', { name: 'Work agent' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Simple conversation' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Task manager' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: label }));
    expect(
      kind === 'agent'
        ? createAgent
        : kind === 'simple'
          ? createSimpleChat
          : createTaskBoard,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/workspaces/Unraid' }),
    );
  });
});
