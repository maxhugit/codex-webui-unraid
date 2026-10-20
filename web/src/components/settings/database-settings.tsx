import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Database, HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getAuthorizationHeader } from '@/auth-token';
import { withBasePath } from '@/base-path';

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
}

async function readDatabaseStatus() {
  const authorization = getAuthorizationHeader();
  const response = await fetch(withBasePath('/api/database/status'), {
    headers: authorization ? { Authorization: authorization } : undefined,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as DatabaseStatus;
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
  const status = useQuery({
    queryKey: ['database-status'],
    queryFn: readDatabaseStatus,
  });

  if (status.isPending)
    return <p className="text-sm text-muted-foreground">{t('Loading…')}</p>;
  if (status.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('Unable to read database information.')}
      </p>
    );

  const database = status.data;
  const size = (value: number) => formatBytes(value, i18n.language);
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">{t('Database')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('Review the storage configuration and current database status.')}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
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
          value={database.connected ? t('Connected') : t('Disconnected')}
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
          <Info label={t('Write-ahead log')} value={size(database.walSizeBytes)} />
          <Info
            label={t('Shared memory')}
            value={size(database.sharedMemorySizeBytes)}
          />
          <Info label={t('Journal mode')} value={database.journalMode} />
          <Info
            label={t('Foreign keys')}
            value={database.foreignKeys ? t('Enabled') : t('Disabled')}
          />
          <Info
            label={t('Access mode')}
            value={database.readOnly ? t('Read-only') : t('Read and write')}
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
    </section>
  );
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
