import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { catalogFixture, json } from './catalog/catalog.testing';
import { ServerVersionCard } from './server-version-card';

let fixture: ReturnType<typeof catalogFixture>;
let fetchMock: ReturnType<typeof vi.fn>;

const status = {
  installed: {
    version: '0.1.0',
    revision: 'abcdef123456',
    builtAt: '2026-10-20T09:00:00Z',
    channel: 'stable' as const,
  },
  latestVersion: '0.2.1',
  latestPublishedAt: '2026-10-21T10:00:00Z',
  latestUrl: 'https://github.com/maxhugit/mergeron/releases/tag/v0.2.1',
  updateAvailable: true,
  versionStatus: 'update_available' as const,
  releases: [
    {
      version: '0.2.0',
      publishedAt: '2026-10-20T10:00:00Z',
      url: 'https://github.com/maxhugit/mergeron/releases/tag/v0.2.0',
      sections: [{ heading: 'Nouveautés', items: ['Ajoute la recherche.'] }],
    },
    {
      version: '0.2.1',
      publishedAt: '2026-10-21T10:00:00Z',
      url: 'https://github.com/maxhugit/mergeron/releases/tag/v0.2.1',
      sections: [{ heading: 'Corrections', items: ['Corrige le mobile.'] }],
    },
  ],
  checkedAt: '2026-10-21T10:05:00Z',
  checkError: null,
};

beforeEach(async () => {
  await i18n.changeLanguage('en');
  fixture = catalogFixture();
  fetchMock = vi.fn(() => Promise.resolve(json(status)));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fixture.dispose();
  vi.unstubAllGlobals();
});

it('shows the installed channel, latest stable version and cumulative changes', async () => {
  fixture.render(<ServerVersionCard />);

  expect(await screen.findByText('0.1.0')).toBeVisible();
  expect(screen.getByText('Stable (latest)')).toBeVisible();
  expect(screen.getByText('0.2.1')).toBeVisible();
  expect(
    screen.getByText('A newer stable Mergeron version is available.'),
  ).toBeVisible();
  expect(screen.getByText('Mergeron 0.2.0')).toBeVisible();
  expect(screen.getByText('Mergeron 0.2.1')).toBeVisible();
  expect(screen.getByText('Ajoute la recherche.')).toBeVisible();
  expect(screen.getByText('Corrige le mobile.')).toBeVisible();
});

it('refreshes only after the administrator requests it', async () => {
  const user = userEvent.setup();
  fixture.render(<ServerVersionCard />);
  await screen.findByText('0.1.0');

  await user.click(screen.getByRole('button', { name: 'Check for updates' }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(fetchMock.mock.calls[1]?.[0]).toBe(
    '/api/settings/release/status?refresh=true',
  );
});

it('does not claim that Mergeron is current when discovery fails', async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      json({
        ...status,
        latestVersion: null,
        latestUrl: null,
        updateAvailable: false,
        versionStatus: 'unknown',
        releases: [],
        checkError: 'unableToCheckForMergeronUpdates',
      }),
    ),
  );
  fixture.render(<ServerVersionCard />);

  expect(
    await screen.findByText('Unable to check for Mergeron updates.'),
  ).toBeVisible();
  expect(
    screen.queryByText('This Mergeron installation is up to date.'),
  ).not.toBeInTheDocument();
});
