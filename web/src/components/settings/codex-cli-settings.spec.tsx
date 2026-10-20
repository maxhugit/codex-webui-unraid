import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { catalogFixture, json } from './catalog/catalog.testing';
import { CodexCliSettings } from './codex-cli-settings';

let fixture: ReturnType<typeof catalogFixture>;
let fetchMock: ReturnType<typeof vi.fn>;
const available = {
  installedVersion: '1.0.0',
  selectedVersion: null,
  imageVersion: '1.0.0',
  latestVersion: '1.1.0',
  updateAvailable: true,
  installedError: null,
  checkError: null,
  checkedAt: null,
  canManage: true,
  canRollback: false,
  busy: false,
};
beforeEach(() => {
  fixture = catalogFixture();
  fetchMock = vi.fn((url: string, options?: RequestInit) =>
    Promise.resolve(
      json(
        options?.method === 'POST'
          ? { success: true }
          : url.endsWith('/releases')
            ? {
                fromVersion: '1.0.0',
                toVersion: '1.1.0',
                releaseError: null,
                releases: [
                  {
                    version: '1.1.0',
                    publishedAt: '2026-10-15T21:30:38Z',
                    url: 'https://github.com/openai/codex/releases/tag/rust-v1.1.0',
                    sections: [
                      {
                        heading: 'New Features',
                        items: ['A verified official release highlight.'],
                      },
                    ],
                  },
                ],
              }
            : available,
      ),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  fixture.dispose();
  vi.unstubAllGlobals();
});

it('displays installed and latest versions and only updates after explicit confirmation', async () => {
  const user = userEvent.setup();
  fixture.render(<CodexCliSettings />);
  await screen.findByText('A CLI update is available');
  expect(
    await screen.findByText('Changes between 1.0.0 and 1.1.0'),
  ).toBeVisible();
  expect(
    await screen.findByText('A verified official release highlight.'),
  ).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'Open the official release note' }),
  ).toHaveAttribute(
    'href',
    'https://github.com/openai/codex/releases/tag/rust-v1.1.0',
  );
  expect(
    fetchMock.mock.calls.some(([, options]) => options?.method === 'POST'),
  ).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Update Codex CLI' }));
  expect(
    fetchMock.mock.calls.some(([, options]) => options?.method === 'POST'),
  ).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/codex/cli/update',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          expectedVersion: '1.0.0',
          targetVersion: '1.1.0',
        }),
      }),
    ),
  );
});

it('does not claim up-to-date status when the registry check failed', async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      json({
        ...available,
        latestVersion: null,
        updateAvailable: false,
        checkError: 'Unable to check npm for updates',
      }),
    ),
  );
  fixture.render(<CodexCliSettings />);
  await screen.findByText('Unable to check npm for updates');
  expect(
    screen.getByRole('button', { name: 'Update Codex CLI' }),
  ).toBeDisabled();
  expect(
    screen.queryByText('No newer stable CLI version is available'),
  ).not.toBeInTheDocument();
});

it('offers rollback for a selected installation even if its binary cannot run', async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      json({
        ...available,
        installedVersion: null,
        selectedVersion: '1.1.0',
        canRollback: true,
      }),
    ),
  );
  const user = userEvent.setup();
  fixture.render(<CodexCliSettings />);
  await user.click(
    await screen.findByRole('button', { name: 'Restore previous CLI' }),
  );
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/codex/cli/rollback',
      expect.objectContaining({
        body: JSON.stringify({ expectedVersion: '1.1.0' }),
      }),
    ),
  );
});
