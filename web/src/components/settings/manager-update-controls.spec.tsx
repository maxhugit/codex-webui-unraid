import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { catalogFixture, json } from './catalog/catalog.testing';
import { ManagerUpdateControls } from './manager-update-controls';
import type { ManagerStatus } from './manager-status-api';

let fixture: ReturnType<typeof catalogFixture>;
const status: ManagerStatus = {
  available: true,
  mode: 'observe',
  dockerConnected: true,
  components: [],
  dataSafety: { status: 'protected', blockers: [], protectedMounts: [] },
  update: { busy: false, operation: null },
};
beforeEach(async () => {
  fixture = catalogFixture();
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
      images: { application: 'ghcr.io/maxhugit/mergeron:edge' },
    });
  });
  vi.stubGlobal('fetch', fetch);
  fixture.render(<ManagerUpdateControls status={status} />);
  await user.click(
    screen.getByRole('button', { name: 'Vérifier le plan de mise à jour' }),
  );
  await user.click(
    await screen.findByRole('button', { name: 'Lancer la mise à jour' }),
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('alertdialog')).toHaveTextContent(
    'Les services seront indisponibles',
  );
  await user.click(screen.getByRole('button', { name: 'Confirmer' }));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({
    confirmation: 'UPDATE_WITH_ROLLBACK',
    expectedFingerprint: 'checked',
  });
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
