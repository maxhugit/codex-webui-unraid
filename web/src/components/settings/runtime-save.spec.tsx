import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { catalogFixture, json } from './catalog/catalog.testing';
import { FilesSettings } from './files-settings';

let fixture: ReturnType<typeof catalogFixture>;
beforeEach(() => {
  fixture = catalogFixture();
  fixture.server.overrides.set('GET /api/settings', () =>
    json({
      settings: [
        {
          key: 'files.uploadMaxBytes',
          value: 100,
          defaultValue: 100,
          type: 'number',
          category: 'files',
          source: 'default',
          description: 'Maximum file upload size in bytes.',
          constraints: { min: 1 },
        },
        {
          key: 'files.excludedDirs',
          value: 'node_modules',
          defaultValue: 'node_modules',
          type: 'string',
          category: 'files',
          source: 'default',
          description:
            'Comma-separated directory/file names excluded from file tree listings.',
          constraints: {},
        },
      ],
    }),
  );
});
afterEach(() => fixture.dispose());

it('validates the complete tab before sending a single atomic batch', async () => {
  const user = userEvent.setup();
  fixture.server.overrides.set('PATCH /api/settings', () =>
    json({ message: 'Write failed' }, 500),
  );
  fixture.render(<FilesSettings />);
  const size = await screen.findByRole('spinbutton');
  const directories = screen.getByRole('textbox');
  fireEvent.change(size, { target: { value: '' } });
  fireEvent.change(directories, { target: { value: 'dist' } });
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(fixture.server.writes).toHaveLength(0);
  fireEvent.change(size, { target: { value: '200' } });
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(fixture.server.writes).toHaveLength(1));
  expect(fixture.server.writes[0]).toEqual({
    method: 'PATCH',
    path: '/api/settings',
    body: {
      updates: [
        { key: 'files.uploadMaxBytes', value: 200 },
        { key: 'files.excludedDirs', value: 'dist' },
      ],
    },
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled(),
  );
  expect(size).toHaveValue(200);
  expect(directories).toHaveValue('dist');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(size).toHaveValue(100);
  expect(directories).toHaveValue('node_modules');
});
