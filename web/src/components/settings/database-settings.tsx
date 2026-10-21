import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Braces,
  CheckCircle2,
  Database,
  HardDrive,
  LayoutDashboard,
  Rows3,
  Search,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getAuthorizationHeader } from '@/auth-token';
import { withBasePath } from '@/base-path';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DatabaseSchemaObject } from './database-schema-graph';

const DatabaseSchemaGraph = lazy(() =>
  import('./database-schema-graph').then((module) => ({
    default: module.DatabaseSchemaGraph,
  })),
);

interface DatabaseStatus {
  engine: string;
  path: string;
  connected: boolean;
  readOnly: boolean;
  databaseSizeBytes: number;
  walSizeBytes: number;
  sharedMemorySizeBytes: number;
  totalSizeBytes: number;
  journalMode: string;
  foreignKeys: boolean;
  pageCount: number;
  pageSizeBytes: number;
  schemaVersion: string;
  appliedMigrationCount: number;
}

interface DatabaseSchema {
  objects: DatabaseSchemaObject[];
}

interface DatabaseRows {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  sensitiveValuesMasked: boolean;
  search: string;
}

async function readDatabase<T>(path: string): Promise<T> {
  const authorization = getAuthorizationHeader();
  const response = await fetch(withBasePath(`/api/database/${path}`), {
    headers: authorization ? { Authorization: authorization } : undefined,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

function formatBytes(value: number, locale: string) {
  if (value === 0) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  const exponent = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / 1024 ** exponent)} ${units[exponent]}`;
}

export function DatabaseSettings() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<'overview' | 'schema' | 'data'>('overview');
  const [table, setTable] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const status = useQuery({
    queryKey: ['database-status'],
    queryFn: () => readDatabase<DatabaseStatus>('status'),
  });
  const schema = useQuery({
    queryKey: ['database-schema'],
    queryFn: () => readDatabase<DatabaseSchema>('schema'),
    staleTime: 60_000,
  });
  const tables = (schema.data?.objects ?? []).filter(
    (object) => object.type === 'table',
  );
  const selectedTable = table || tables[0]?.name || '';
  const rows = useQuery({
    queryKey: ['database-rows', selectedTable, page, pageSize, search],
    queryFn: () =>
      readDatabase<DatabaseRows>(
        `rows?table=${encodeURIComponent(selectedTable)}&page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}`,
      ),
    enabled: tab === 'data' && Boolean(selectedTable),
    placeholderData: (previous) => previous,
  });

  const database = status.data;
  const size = (value: number) => formatBytes(value, i18n.language);
  const tabs = [
    { id: 'overview' as const, label: 'Overview', icon: LayoutDashboard },
    { id: 'schema' as const, label: 'Schema', icon: Braces },
    { id: 'data' as const, label: 'Data', icon: Rows3 },
  ];
  const openTable = (name: string) => {
    setTable(name);
    setPage(1);
    setSearch('');
    setTab('data');
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 min-w-0 shrink-0 items-center border-b bg-background">
        <div
          role="tablist"
          aria-label={t('Database sections')}
          className="flex min-w-0 flex-1 items-center overflow-x-auto"
        >
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                'flex h-10 shrink-0 cursor-pointer items-center gap-2 border-b-2 px-3 text-xs transition-colors hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]',
                tab === id
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {t(label)}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <div className="min-h-0 flex-1 space-y-5 overflow-auto px-4 py-4 sm:px-6">
          {status.isPending && (
            <p className="text-sm text-muted-foreground">{t('Loading…')}</p>
          )}
          {status.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('Unable to read database information.')}
            </p>
          )}
          {database && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <InfoCard
                  icon={Database}
                  label={t('Engine')}
                  value={database.engine}
                />
                <InfoCard
                  icon={HardDrive}
                  label={t('Current size')}
                  value={size(database.totalSizeBytes)}
                />
                <InfoCard
                  icon={CheckCircle2}
                  label={t('Status')}
                  value={
                    database.connected ? t('Connected') : t('Disconnected')
                  }
                />
                <InfoCard
                  icon={Braces}
                  label={t('Database version')}
                  value={database.schemaVersion}
                />
              </div>
              <div className="rounded-xl border p-4">
                <h3 className="text-sm font-semibold">{t('Storage')}</h3>
                <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                  <Info label={t('Database path')} value={database.path} wide />
                  <Info
                    label={t('Database file')}
                    value={size(database.databaseSizeBytes)}
                  />
                  <Info
                    label={t('Write-ahead log')}
                    value={size(database.walSizeBytes)}
                  />
                  <Info
                    label={t('Shared memory')}
                    value={size(database.sharedMemorySizeBytes)}
                  />
                  <Info
                    label={t('Journal mode')}
                    value={database.journalMode}
                  />
                  <Info
                    label={t('Foreign keys')}
                    value={database.foreignKeys ? t('Enabled') : t('Disabled')}
                  />
                  <Info
                    label={t('Access mode')}
                    value={
                      database.readOnly ? t('Read-only') : t('Read and write')
                    }
                  />
                  <Info
                    label={t('Pages')}
                    value={new Intl.NumberFormat(i18n.language).format(
                      database.pageCount,
                    )}
                  />
                </dl>
                <p className="mt-4 text-xs text-muted-foreground">
                  {t(
                    'The database path is configured with WEBUI_DB_PATH and is applied when the server starts.',
                  )}
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'schema' && (
        <div className="flex min-h-0 flex-1 flex-col px-4 py-3 sm:px-6">
          {schema.isPending && <p>{t('Loading…')}</p>}
          {schema.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('Unable to read the database schema.')}
            </p>
          )}
          {schema.data && (
            <Suspense fallback={<p>{t('Loading…')}</p>}>
              <DatabaseSchemaGraph
                objects={schema.data.objects}
                onOpenTable={openTable}
              />
            </Suspense>
          )}
        </div>
      )}

      {tab === 'data' && (
        <div className="flex min-h-0 flex-1 flex-col px-4 py-4 sm:px-6">
          <div className="mb-3 flex shrink-0 flex-wrap items-end gap-3">
            <label className="space-y-1 text-sm">
              <span className="block text-xs text-muted-foreground">
                {t('Table')}
              </span>
              <select
                value={selectedTable}
                onChange={(event) => {
                  setTable(event.target.value);
                  setPage(1);
                  setSearch('');
                }}
                className="h-9 min-w-64 rounded-md border bg-background px-3"
              >
                {tables.map((object) => (
                  <option key={object.name} value={object.name}>
                    {object.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-56 flex-1 space-y-1 text-sm">
              <span className="block text-xs text-muted-foreground">
                {t('Search in table')}
              </span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder={t('Search across visible columns…')}
                  className="h-9 w-full rounded-md border bg-background pl-9 pr-3"
                />
              </span>
            </label>
            <label className="space-y-1 text-sm">
              <span className="block text-xs text-muted-foreground">
                {t('Rows per page')}
              </span>
              <select
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value));
                  setPage(1);
                }}
                className="h-9 rounded-md border bg-background px-3"
              >
                {[10, 25, 50, 100].map((sizeOption) => (
                  <option key={sizeOption} value={sizeOption}>
                    {sizeOption}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="mb-3 shrink-0 text-xs text-muted-foreground">
            {t(
              'Read-only view. Sensitive values are masked and rows are paginated.',
            )}
          </p>
          {(schema.isPending || rows.isPending) && <p>{t('Loading…')}</p>}
          {(schema.isError || rows.isError) && (
            <p role="alert" className="text-sm text-destructive">
              {t('Unable to read database rows.')}
            </p>
          )}
          {rows.data && (
            <>
              <div className="min-h-0 flex-1 overflow-auto rounded-xl border">
                <table className="w-full min-w-max text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-muted text-muted-foreground shadow-[0_1px_0_var(--border)]">
                    <tr>
                      {rows.data.columns.map((column) => (
                        <th key={column} className="px-3 py-2 font-medium">
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.data.rows.map((row, index) => (
                      <tr key={index} className="border-t align-top">
                        {rows.data.columns.map((column) => (
                          <td
                            key={column}
                            className="max-w-96 whitespace-pre-wrap break-words px-3 py-2 font-mono"
                          >
                            {formatCell(row[column])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.data.rows.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">
                    {t('This table is empty.')}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center justify-between gap-3 pt-3 text-sm">
                <span className="text-muted-foreground">
                  {t('{{count}} row', { count: rows.data.total })} ·{' '}
                  {t('Page {{page}} of {{total}}', {
                    page: rows.data.page,
                    total: rows.data.totalPages,
                  })}
                </span>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1 || rows.isFetching}
                    onClick={() => setPage((current) => current - 1)}
                  >
                    {t('Previous')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= rows.data.totalPages || rows.isFetching}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    {t('Next')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function InfoCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Database;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <p className="mt-2 truncate text-lg font-semibold" title={value}>
        {value}
      </p>
    </div>
  );
}

function Info({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-all font-medium">{value}</dd>
    </div>
  );
}
