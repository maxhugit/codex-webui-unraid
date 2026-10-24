import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { catalogFixture, deferred, json } from './catalog/catalog.testing';
import { ManagerUpdateControls } from './manager-update-controls';
import type { ManagerStatus } from './manager-status-api';
import {
  requestServerRelease,
  type ServerReleaseStatus,
} from './server-release-api';

vi.mock('./server-release-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./server-release-api')>()),
  requestServerRelease: vi.fn(),
}));

const release: ServerReleaseStatus = {
  installed: {
    version: '0.1.0',
    revision: null,
    builtAt: null,
    channel: 'stable',
  },
  latestVersion: '0.1.1',
  latestPublishedAt: null,
  latestUrl: null,
  updateAvailable: true,
  versionStatus: 'update_available',
  releases: [],
  checkedAt: '2026-10-24T00:00:00Z',
  checkError: null,
};

let fixture: ReturnType<typeof catalogFixture>;
const status: ManagerStatus = {
  available: true,
  environment: 'production',
  mode: 'observe',
  dockerConnected: true,
  components: [],
  dataSafety: { status: 'protected', blockers: [], protectedMounts: [] },
  update: { busy: false, operation: null },
};
beforeEach(async () => {
  fixture = catalogFixture();
  vi.mocked(requestServerRelease).mockReset();
  vi.mocked(requestServerRelease).mockResolvedValue(release);
  await i18n.changeLanguage('fr');
});
afterEach(() => {
  fixture.dispose();
  vi.unstubAllGlobals();
});

it('previews without applying and requires a second explicit confirmation', async () => {
  const user = userEvent.setup();
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return json({
      applicable: true,
      fingerprint: 'checked',
      blockers: [],
      images: { application: 'ghcr.io/maxhugit/mergeron:0.1.1' },
    });
  });
  vi.stubGlobal('fetch', fetch);
  fixture.render(<ManagerUpdateControls status={status} />);
  await screen.findByDisplayValue('ghcr.io/maxhugit/mergeron:0.1.1');
  await user.click(screen.getByRole('button', { name: 'Mettre à jour' }));
  await screen.findByRole('alertdialog');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
    images: { application: 'ghcr.io/maxhugit/mergeron:0.1.1' },
  });
  expect(screen.getByRole('alertdialog')).toHaveTextContent(
    'Les services seront indisponibles',
  );
  await user.click(
    screen.getByRole('button', { name: 'Installer et redémarrer' }),
  );
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({
    confirmation: 'UPDATE_WITH_ROLLBACK',
    expectedFingerprint: 'checked',
  });
});

it('uses edge only for an explicitly declared development stack', () => {
  fixture.render(
    <ManagerUpdateControls
      status={{ ...status, environment: 'development' }}
    />,
  );
  expect(
    screen.getByDisplayValue('ghcr.io/maxhugit/mergeron:edge'),
  ).toHaveValue('ghcr.io/maxhugit/mergeron:edge');
  expect(requestServerRelease).toHaveBeenCalled();
});

it('does not overwrite a manually selected image when release discovery completes', async () => {
  const pending = deferred<ServerReleaseStatus>();
  vi.mocked(requestServerRelease).mockReturnValue(pending.promise);
  fixture.render(<ManagerUpdateControls status={status} />);
  const user = userEvent.setup();
  await user.click(
    screen.getByText('Options avancées : choisir une autre image'),
  );
  const input = screen.getByRole('textbox');
  await user.clear(input);
  await user.type(input, 'ghcr.io/maxhugit/mergeron:0.1.2');
  await act(async () => pending.resolve(release));
  expect(input).toHaveValue('ghcr.io/maxhugit/mergeron:0.1.2');
});

it('waits for automatic discovery before requesting a plan', async () => {
  const pending = deferred<ServerReleaseStatus>();
  vi.mocked(requestServerRelease).mockReturnValue(pending.promise);
  const fetch = vi.fn(async () =>
    json({
      applicable: true,
      fingerprint: 'checked',
      blockers: [],
      images: { application: 'ghcr.io/maxhugit/mergeron:0.1.1' },
    }),
  );
  vi.stubGlobal('fetch', fetch);
  fixture.render(<ManagerUpdateControls status={status} />);
  const user = userEvent.setup();
  expect(screen.getByRole('button', { name: 'Mettre à jour' })).toBeDisabled();
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => pending.resolve(release));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Mettre à jour' })).toBeEnabled(),
  );
  await user.click(screen.getByRole('button', { name: 'Mettre à jour' }));
  await screen.findByRole('alertdialog');
  expect(
    screen.getByDisplayValue('ghcr.io/maxhugit/mergeron:0.1.1'),
  ).toHaveValue('ghcr.io/maxhugit/mergeron:0.1.1');
});

it('warns that rollback also restores data and does not run without confirmation', async () => {
  const user = userEvent.setup();
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return json({});
  });
  vi.stubGlobal('fetch', fetch);
  const updated: ManagerStatus = {
    ...status,
    update: {
      busy: false,
      operation: {
        id: 'operation',
        status: 'succeeded',
        phase: 'complete',
        events: [],
        images: {},
        previousImages: {},
        backupRetained: true,
      },
    },
  };
  fixture.render(<ManagerUpdateControls status={updated} />);
  await user.click(
    screen.getByRole('button', { name: 'Restaurer la version précédente' }),
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.getByRole('alertdialog')).toHaveTextContent(
    'ET les données sauvegardées',
  );
  await user.click(screen.getByRole('button', { name: 'Confirmer' }));
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
    confirmation: 'ROLLBACK_WITH_DATA_RESTORE',
    operationId: 'operation',
  });
});

it('has one update entry point, checks first, and installs only the immutable reviewed image after confirmation', async () => {
  const digest = `sha256:${'a'.repeat(64)}`;
  const target = `ghcr.io/maxhugit/mergeron@${digest}`;
  vi.mocked(requestServerRelease).mockResolvedValue({
    ...release,
    targetImage: 'ghcr.io/maxhugit/mergeron:latest',
    targetDigest: digest,
  });
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return Promise.resolve(
      json({
        applicable: true,
        fingerprint: 'immutable',
        blockers: [],
        images: { application: target },
      }),
    );
  });
  vi.stubGlobal('fetch', fetch);
  fixture.render(<ManagerUpdateControls status={status} />);
  await screen.findByDisplayValue('ghcr.io/maxhugit/mergeron:latest');
  expect(
    screen.queryByRole('button', { name: 'Vérifier le plan de mise à jour' }),
  ).not.toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Mettre à jour' }));
  await screen.findByRole('alertdialog');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
    images: { application: target },
  });
  await user.click(
    screen.getByRole('button', { name: 'Installer et redémarrer' }),
  );
  expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({
    images: { application: target },
    confirmation: 'UPDATE_WITH_ROLLBACK',
    expectedFingerprint: 'immutable',
  });
});

it('does not offer a default update when automatic detection reports no new image', async () => {
  vi.mocked(requestServerRelease).mockResolvedValue({
    ...release,
    targetImage: 'ghcr.io/maxhugit/mergeron:latest',
    updateAvailable: false,
  });
  fixture.render(<ManagerUpdateControls status={status} />);
  await screen.findByDisplayValue('ghcr.io/maxhugit/mergeron:latest');
  expect(screen.getByRole('button', { name: 'Mettre à jour' })).toBeDisabled();
});
