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
import { getAuthorizationHeader } from '@/auth-token';
import { withBasePath } from '@/base-path';
import {
  codexConfigReadConfigQueryKey,
  codexStatusGetStatusQueryKey,
  modelsListModelsQueryKey,
} from '@/generated/api/@tanstack/react-query.gen';

interface CliStatus {
  selectedVersion: string | null;
  installedVersion: string | null;
  imageVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  installedError: string | null;
  checkError: string | null;
  checkedAt: string | null;
  canManage: boolean;
  canRollback: boolean;
  busy: boolean;
}
const queryKey = ['administration', 'codex-cli'];
async function request<T>(path = '', body?: unknown): Promise<T> {
  const authorization = getAuthorizationHeader();
  const response = await fetch(withBasePath(`/api/codex/cli${path}`), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await response.json()) as T & {
    message?: string | string[];
    blockers?: { reason: string }[];
  };
  if (!response.ok)
    throw new Error(
      [
        ...(Array.isArray(data.message)
          ? data.message
          : [data.message ?? `HTTP ${response.status}`]),
        ...(data.blockers?.map((blocker) => blocker.reason) ?? []),
      ].join('\n'),
    );
  return data;
}

export function CodexCliSettings() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [confirmation, setConfirmation] = useState<
    'update' | 'rollback' | null
  >(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const status = useQuery({
    queryKey,
    queryFn: () => request<CliStatus>(),
    staleTime: 60_000,
    refetchInterval: 60_000,
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
      request(`/${action}`, {
        expectedVersion: installedVersion,
        ...(action === 'update' ? { targetVersion: latestVersion } : {}),
      }),
    onSettled: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey }),
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
      client.setQueryData(queryKey, await request<CliStatus>('?refresh=true'));
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
