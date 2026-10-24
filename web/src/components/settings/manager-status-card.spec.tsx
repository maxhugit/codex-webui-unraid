import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  adoption: {
    state: 'eligible' as const,
    fingerprint: 'verified-fingerprint',
    adoptedAt: null,
    blockers: [],
    canAdopt: true,
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

it('shows an existing protected installation as explicitly adoptable', async () => {
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
  expect(
    screen.getByRole('button', { name: 'Adopt this installation' }),
  ).toBeVisible();
});

it('adopts only after confirmation and sends the verified fingerprint', async () => {
  const user = userEvent.setup();
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST')
      return json({
        ...protectedStatus,
        components: protectedStatus.components.map((component) => ({
          ...component,
          adoption: 'managed' as const,
        })),
        adoption: {
          state: 'adopted' as const,
          fingerprint: 'verified-fingerprint',
          adoptedAt: '2026-10-24T09:05:00Z',
          blockers: [],
          canAdopt: false,
        },
      });
    return json(protectedStatus);
  });
  vi.stubGlobal('fetch', fetch);
  fixture.render(<ManagerStatusCard />);

  await user.click(
    await screen.findByRole('button', { name: 'Adopt this installation' }),
  );
  expect(
    screen.getByText(
      /will record the exact container IDs, images, networks and persistent paths/i,
    ),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Confirm adoption' }));

  expect(
    await screen.findByText('Existing installation adopted'),
  ).toBeVisible();
  const request = fetch.mock.calls.find((call) => call[1]?.method === 'POST');
  expect(request?.[1]?.body).toBe(
    JSON.stringify({
      confirmation: 'ADOPT_EXISTING_INSTALLATION',
      expectedFingerprint: 'verified-fingerprint',
    }),
  );
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
