/** Administrator-only controls for the managed app-server CLI, not a shell console. */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  codexConfigReadConfigQueryKey,
  codexStatusGetStatusQueryKey,
  modelsListModelsQueryKey,
} from '@/generated/api/@tanstack/react-query.gen';
import { localizedSourceCopy } from '@/lib/catalog-copy';
import { cliStatusQueryKey, requestCli, type CliStatus } from './codex-cli-api';
interface CliReleaseSection {
  heading: string;
  items: string[];
}
interface CliReleaseNote {
  version: string;
  publishedAt: string | null;
  url: string;
  sections: CliReleaseSection[];
}
interface CliReleaseHistory {
  fromVersion: string | null;
  toVersion: string | null;
  releases: CliReleaseNote[];
  releaseError: string | null;
}
const releaseQueryKey = [...cliStatusQueryKey, 'releases'] as const;

export function CodexCliSettings() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [confirmation, setConfirmation] = useState<
    'update' | 'rollback' | null
  >(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const status = useQuery({
    queryKey: cliStatusQueryKey,
    queryFn: () => requestCli<CliStatus>(),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const releases = useQuery({
    queryKey: releaseQueryKey,
    queryFn: () => requestCli<CliReleaseHistory>('/releases'),
    enabled: Boolean(status.data?.updateAvailable),
    staleTime: 15 * 60_000,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: ({
      action,
      installedVersion,
      latestVersion,
    }: {
      action: 'update' | 'rollback';
      installedVersion: string;
      latestVersion: string | null;
    }) =>
      requestCli(`/${action}`, {
        expectedVersion: installedVersion,
        ...(action === 'update' ? { targetVersion: latestVersion } : {}),
      }),
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: cliStatusQueryKey }),
        client.invalidateQueries({ queryKey: codexStatusGetStatusQueryKey() }),
        client.invalidateQueries({ queryKey: modelsListModelsQueryKey() }),
        client.invalidateQueries({ queryKey: codexConfigReadConfigQueryKey() }),
      ]);
    },
  });
  const data = status.data;
  const busy = mutation.isPending || data?.busy || checking;
  const check = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      client.setQueryData(
        cliStatusQueryKey,
        await requestCli<CliStatus>('?refresh=true'),
      );
      await client.invalidateQueries({ queryKey: releaseQueryKey });
    } catch (error) {
      setCheckError(String(error));
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
        <h3 className="text-sm font-semibold">
          {t('Codex CLI on this server')}
        </h3>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <dt>{t('Installed version')}</dt>
          <dd>{data?.installedVersion ?? t('Unknown')}</dd>
          <dt>{t('Image version')}</dt>
          <dd>{data?.imageVersion ?? t('Unknown')}</dd>
          <dt>{t('Latest stable version')}</dt>
          <dd>{data?.latestVersion ?? t('Unknown')}</dd>
        </dl>
        {data?.checkedAt && (
          <p className="text-xs text-muted-foreground">
            {t('Last checked')}:{' '}
            {new Date(data.checkedAt).toLocaleString(i18n.language)}
          </p>
        )}
        {status.isLoading && <p>{t('Loading...')}</p>}
        {data?.installedVersion && data.latestVersion && (
          <p role="status">
            {data.updateAvailable
              ? t('A CLI update is available')
              : t('No newer stable CLI version is available')}
          </p>
        )}
        {[
          data?.installedError,
          data?.checkError,
          checkError,
          status.error?.message,
          mutation.error?.message,
        ]
          .filter(Boolean)
          .map((error, index) => (
            <p
              key={index}
              role="alert"
              className="whitespace-pre-wrap text-sm text-destructive"
            >
              {error!
                .split('\n')
                .map((line) => t(line))
                .join('\n')}
            </p>
          ))}
        {mutation.isSuccess && (
          <p role="status">{t('CLI operation completed')}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void check()}
          >
            {t('Check for CLI updates')}
          </Button>
          <Button
            disabled={
              busy ||
              !data?.canManage ||
              !data.installedVersion ||
              !data.updateAvailable
            }
            onClick={() => setConfirmation('update')}
          >
            {t('Update Codex CLI')}
          </Button>
          {data?.canRollback && (
            <Button
              variant="outline"
              disabled={
                busy || !(data.selectedVersion ?? data.installedVersion)
              }
              onClick={() => setConfirmation('rollback')}
            >
              {t('Restore previous CLI')}
            </Button>
          )}
        </div>
        {busy && (
          <p role="status">
            {t('CLI operation in progress. Do not start new work.')}
          </p>
        )}
        {data && !data.canManage && (
          <p className="text-xs text-muted-foreground">
            {t('This CLI installation is managed externally')}
          </p>
        )}
      </div>
      {data?.updateAvailable && (
        <section className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">
              {t('Changes between {{from}} and {{to}}', {
                from: data.installedVersion,
                to: data.latestVersion,
              })}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t(
                'Official OpenAI release notes are translated into the interface language when a translation is available.',
              )}
            </p>
          </div>
          {releases.isLoading && (
            <p className="text-sm text-muted-foreground">
              {t('Loading release notes...')}
            </p>
          )}
          {(releases.data?.releaseError || releases.error) && (
            <p role="alert" className="text-sm text-amber-500">
              {t(
                releases.data?.releaseError ??
                  'Unable to load official CLI release notes',
              )}
            </p>
          )}
          {(releases.data?.releases ?? []).map((release) => (
            <article
              key={release.version}
              className="space-y-3 rounded-lg border border-border bg-background/60 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-medium">Codex CLI {release.version}</h4>
                {release.publishedAt && (
                  <time
                    dateTime={release.publishedAt}
                    className="text-xs text-muted-foreground"
                  >
                    {new Date(release.publishedAt).toLocaleDateString(
                      i18n.language,
                    )}
                  </time>
                )}
              </div>
              {release.sections.map((section) => (
                <div key={section.heading} className="space-y-1.5">
                  <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t(section.heading)}
                  </h5>
                  <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
                    {section.items.map((item) => (
                      <li key={item}>{localizedSourceCopy(item)}</li>
                    ))}
                  </ul>
                </div>
              ))}
              <a
                href={release.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex text-sm text-primary underline underline-offset-4"
              >
                {t('Open the official release note')}
              </a>
            </article>
          ))}
        </section>
      )}
      <p className="text-xs text-muted-foreground">
        {t(
          'CLI updates are installed in persistent storage without changing the container image. Codex must be idle. A failed activation restores the previous selection. A newer CLI may require a WebUI update for full compatibility.',
        )}
      </p>
      <p className="text-xs text-amber-500">
        {t(
          'Back up the Codex home before updating. A newer CLI may migrate its data; restoring an older binary does not undo data migrations. Idle checks cover the managed app-server only.',
        )}
      </p>
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                confirmation === 'rollback'
                  ? 'Restore previous CLI'
                  : 'Update Codex CLI',
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'This restarts the managed Codex app-server. The operation is refused while work is active. Conversations and configuration are preserved.',
              )}{' '}
              {confirmation === 'update' && data?.latestVersion}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const expected =
                  confirmation === 'rollback'
                    ? (data?.selectedVersion ?? data?.installedVersion)
                    : data?.installedVersion;
                if (confirmation && expected)
                  mutation.mutate({
                    action: confirmation,
                    installedVersion: expected,
                    latestVersion: data?.latestVersion ?? null,
                  });
                setConfirmation(null);
              }}
            >
              {t('Confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
