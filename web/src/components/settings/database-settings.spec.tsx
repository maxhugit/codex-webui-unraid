import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { catalogFixture, json } from './catalog/catalog.testing';
import { DatabaseSettings } from './database-settings';

vi.mock('@/stores/theme-store', () => ({
  useThemeStore: (select: (state: { dark: boolean }) => unknown) =>
    select({ dark: false }),
}));

let fixture: ReturnType<typeof catalogFixture>;

beforeEach(() => {
  fixture = catalogFixture();
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const request =
      input instanceof Request
        ? input
        : new Request(new URL(String(input), 'http://localhost'), init);
    return fixture.fetch(request);
  });
  fixture.server.overrides.set('GET /api/database/status', () =>
    json({
      engine: 'SQLite',
      path: '/data/app.sqlite',
      connected: true,
      readOnly: false,
      databaseSizeBytes: 1024,
      walSizeBytes: 0,
      sharedMemorySizeBytes: 0,
      totalSizeBytes: 1024,
      journalMode: 'WAL',
      foreignKeys: true,
      pageCount: 1,
      pageSizeBytes: 4096,
    }),
  );
  fixture.server.overrides.set('GET /api/database/schema', () =>
    json({
      objects: [
        {
          name: 'people',
          type: 'table',
          sql: 'CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT)',
          foreignKeys: [],
          columns: [
            {
              position: 0,
              name: 'id',
              type: 'TEXT',
              notNull: true,
              defaultValue: null,
              primaryKeyPosition: 1,
            },
            {
              position: 1,
              name: 'name',
              type: 'TEXT',
              notNull: false,
              defaultValue: null,
              primaryKeyPosition: 0,
            },
          ],
        },
        {
          name: 'projects',
          type: 'table',
          sql: 'CREATE TABLE projects (id TEXT PRIMARY KEY, owner_id TEXT REFERENCES people(id))',
          foreignKeys: [
            {
              id: 0,
              sequence: 0,
              referencedTable: 'people',
              fromColumn: 'owner_id',
              toColumn: 'id',
              onUpdate: 'NO ACTION',
              onDelete: 'NO ACTION',
              match: 'NONE',
            },
          ],
          columns: [
            {
              position: 0,
              name: 'id',
              type: 'TEXT',
              notNull: true,
              defaultValue: null,
              primaryKeyPosition: 1,
            },
            {
              position: 1,
              name: 'owner_id',
              type: 'TEXT',
              notNull: false,
              defaultValue: null,
              primaryKeyPosition: 0,
            },
          ],
        },
      ],
    }),
  );
  fixture.server.overrides.set('GET /api/database/rows', () =>
    json({
      table: 'people',
      columns: ['id', 'name', 'api_token'],
      rows: [{ id: 'p1', name: 'Maxime', api_token: '••••••' }],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
      sensitiveValuesMasked: true,
    }),
  );
});

afterEach(() => {
  fixture.dispose();
  vi.unstubAllGlobals();
});

it('separates overview, schema and paginated read-only data', async () => {
  const user = userEvent.setup();
  fixture.render(<DatabaseSettings />);

  expect(
    await screen.findByRole('tab', { name: 'Overview', selected: true }),
  ).toBeVisible();
  expect(await screen.findByText('/data/app.sqlite')).toBeVisible();

  await user.click(screen.getByRole('tab', { name: 'Schema' }));
  expect(
    await screen.findByRole('img', { name: 'Database relationship map' }),
  ).toBeVisible();
  expect(screen.getByText('1 relation')).toBeVisible();
  expect(screen.getByText('people')).toBeInTheDocument();
  expect(screen.getByText('projects')).toBeInTheDocument();
  expect(screen.getByLabelText('Foreign key')).toBeInTheDocument();

  await user.click(screen.getByRole('tab', { name: 'Data' }));
  expect(await screen.findByText('Maxime')).toBeVisible();
  expect(screen.getByText('••••••')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
});
