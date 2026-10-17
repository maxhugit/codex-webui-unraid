import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProjectResourceRow } from './project-resource-row';

describe('ProjectResourceRow', () => {
  it.each([
    ['Rename', 'rename'],
    ['Move to another project', 'move'],
    ['Delete', 'delete'],
  ] as const)('offers the %s action', async (label, action) => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const onMove = vi.fn();
    const onDelete = vi.fn();
    render(
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
        onMove={onMove}
        onDelete={onDelete}
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Actions for Gestionnaire de tâches',
      }),
    );
    await user.click(screen.getByRole('button', { name: label }));
    expect(
      action === 'rename' ? onRename : action === 'move' ? onMove : onDelete,
    ).toHaveBeenCalledOnce();
  });
});
