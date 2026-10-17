import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DragDropProvider } from '@dnd-kit/react';
import { ProjectResourceRow } from './project-resource-row';

describe('ProjectResourceRow', () => {
  it.each([
    ['Rename', 'rename'],
    ['Delete', 'delete'],
  ] as const)('offers the %s action', async (label, action) => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const onDelete = vi.fn();
    render(
      <DragDropProvider>
        <ProjectResourceRow
          resource={{
            id: 'resource-1',
            projectId: 'project-1',
            type: 'task_board',
            name: 'Gestionnaire de tâches',
            config: {},
            createdAt: 1,
            updatedAt: 1,
          }}
          active={false}
          pending={false}
          onOpen={vi.fn()}
          onRename={onRename}
          onDelete={onDelete}
        />
      </DragDropProvider>,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Actions for Gestionnaire de tâches',
      }),
    );
    await user.click(screen.getByRole('button', { name: label }));
    expect(action === 'rename' ? onRename : onDelete).toHaveBeenCalledOnce();
  });
});
