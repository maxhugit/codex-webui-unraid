import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { catalogFixture, json } from './catalog/catalog.testing';
import { DatabaseSettings } from './database-settings';

vi.mock('@/stores/theme-store', () => ({
  useThemeStore: (select: (state: { dark: boolean }) => unknown) =>
    select({ dark: false }),
}));

let fixture: ReturnType<typeof catalogFixture>;
let lastRowsUrl = '';

beforeEach(() => {
  lastRowsUrl = '';
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
      schemaVersion: '0032_project_deliverables',
      appliedMigrationCount: 33,
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
  fixture.server.overrides.set('GET /api/database/rows', (request) => {
    lastRowsUrl = request.url;
    return json({
      table: 'people',
      columns: ['id', 'name', 'api_token'],
      rows: [{ id: 'p1', name: 'Maxime', api_token: '••••••' }],
      page: 1,
      pageSize: 25,
      total: 1,
      totalPages: 1,
      sensitiveValuesMasked: true,
    });
  });
});

afterEach(() => {
  window.localStorage.clear();
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
  expect(screen.getByText('0032_project_deliverables')).toBeVisible();

  await user.click(screen.getByRole('tab', { name: 'Schema' }));
  expect(
    await screen.findByRole('img', { name: 'Database relationship map' }),
  ).toBeVisible();
  expect(screen.getByText('1 relation')).toBeVisible();
  expect(screen.getByText('people')).toBeInTheDocument();
  expect(screen.getByText('projects')).toBeInTheDocument();
  expect(screen.getByLabelText('Foreign key')).toBeInTheDocument();

  fireEvent.click(screen.getByText('people'));
  expect(screen.getByTestId('database-table-people')).toHaveAttribute(
    'data-selected',
    'true',
  );
  expect(screen.getByTestId('database-table-projects')).toHaveAttribute(
    'data-child',
    'true',
  );
  expect(screen.getByText('Parent tables')).toBeVisible();
  expect(screen.getByText('Child tables')).toBeVisible();

  fireEvent.click(screen.getByText('projects'));
  expect(screen.getByTestId('database-table-people')).toHaveAttribute(
    'data-parent',
    'true',
  );

  fireEvent.doubleClick(screen.getByText('projects'));
  expect(
    screen.getByRole('tab', { name: 'Data', selected: true }),
  ).toBeVisible();
  expect(screen.getByLabelText('Table')).toHaveValue('projects');
  expect(await screen.findByText('Maxime')).toBeVisible();
  expect(screen.getByText('••••••')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();

  await user.type(screen.getByRole('searchbox'), 'Maxime');
  await user.selectOptions(screen.getByLabelText('Rows per page'), '50');
  await waitFor(() => {
    const parameters = new URL(lastRowsUrl).searchParams;
    expect(parameters.get('search')).toBe('Maxime');
    expect(parameters.get('pageSize')).toBe('50');
  });
});
