import { screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { catalogFixture, json } from './catalog/catalog.testing';
import { ManagerStatusCard } from './manager-status-card';

let fixture: ReturnType<typeof catalogFixture>;

const protectedStatus = {
  available: true,
  schemaVersion: 1,
  stack: 'mergeron',
  mode: 'observe' as const,
  observedAt: '2026-10-24T08:00:00Z',
  dockerConnected: true,
  components: [
    {
      id: 'application' as const,
      displayName: 'Mergeron',
      state: 'healthy' as const,
      adoption: 'adoptable' as const,
      containerId: 'abcdef123456',
      containerName: 'codex-webui',
      image: 'ghcr.io/maxhugit/mergeron:latest',
      imageRepositoryAllowed: true,
      health: 'healthy',
      restartCount: 0,
      networks: ['mergeron-isolated'],
      missingNetworks: [],
      protectedMounts: [
        {
          target: '/home/codex',
          purpose: 'applicationState',
          present: true,
          source: '/mnt/user/appdata/mergeron/state/home',
          type: 'bind',
          writable: true,
        },
      ],
    },
  ],
  dataSafety: {
    status: 'protected' as const,
    blockers: [],
    protectedMounts: [
      {
        component: 'application',
        target: '/home/codex',
        purpose: 'applicationState',
        present: true,
        source: '/mnt/user/appdata/mergeron/state/home',
        type: 'bind',
        writable: true,
      },
    ],
  },
};

beforeEach(async () => {
  await i18n.changeLanguage('en');
  fixture = catalogFixture();
});

afterEach(() => {
  fixture.dispose();
  vi.unstubAllGlobals();
});

it('shows an existing installation as adoptable without offering a mutation', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(json(protectedStatus))),
  );
  fixture.render(<ManagerStatusCard />);

  expect(
    await screen.findByText(
      'The existing persistent data mounts have been found. The installation can be adopted without moving data.',
    ),
  ).toBeVisible();
  expect(screen.getByText(/Management/)).toHaveTextContent(
    'Existing installation detected',
  );
  expect(screen.getByText('codex-webui')).toBeVisible();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

it('makes a missing manager non-blocking for the current installation', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        json({
          available: false,
          mode: 'observe',
          dockerConnected: false,
          components: [],
          dataSafety: {
            status: 'unknown',
            blockers: [],
            protectedMounts: [],
          },
          error: 'mergeronManagerUnavailable',
        }),
      ),
    ),
  );
  fixture.render(<ManagerStatusCard />);

  expect(
    await screen.findByText('Mergeron Manager is not connected'),
  ).toBeVisible();
  expect(
    screen.getByText(
      'The current installation continues to run normally. Nothing is migrated or deleted.',
    ),
  ).toBeVisible();
});
