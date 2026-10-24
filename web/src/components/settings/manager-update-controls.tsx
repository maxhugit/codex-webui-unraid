import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { translationKey } from '@/locales/translation-key';
import {
  managerStatusQueryKey,
  requestManagerUpdate,
  type ManagerStatus,
  type ManagerUpdatePlan,
} from './manager-status-api';
import { defaultManagerUpdateImage } from './manager-update-image';
import {
  requestServerRelease,
  serverReleaseQueryKey,
} from './server-release-api';

const phases: Record<string, string> = {
  preparing: 'managerUpdatePreparing',
  stopping: 'managerUpdateStopping',
  backingUp: 'managerUpdateBackingUp',
  replacing: 'managerUpdateReplacing',
  checkingHealth: 'managerUpdateCheckingHealth',
  committing: 'managerUpdateCommitting',
  rollingBack: 'managerUpdateRollingBack',
  recoveryRequired: 'managerUpdateRecoveryRequired',
  complete: 'managerUpdateComplete',
};
const statuses: Record<string, string> = {
  running: 'managerUpdateRunning',
  succeeded: 'managerUpdateSucceeded',
  rolledBack: 'managerUpdateRolledBack',
  recoveryRequired: 'managerUpdateRecoveryRequired',
};

export function ManagerUpdateControls({ status }: { status: ManagerStatus }) {
  const { t, i18n } = useTranslation('manager');
  const { t: common } = useTranslation();
  const client = useQueryClient();
  const release = useQuery({
    queryKey: serverReleaseQueryKey,
    queryFn: () => requestServerRelease(),
    enabled: true,
    staleTime: 15 * 60_000,
    retry: false,
  });
  const [imageOverride, setImage] = useState<string | null>(null);
  const [manualSelection, setManualSelection] = useState(false);
  const image =
    imageOverride ?? defaultManagerUpdateImage(status, release.data);
  const [plan, setPlan] = useState<ManagerUpdatePlan | null>(null);
  const [confirm, setConfirm] = useState<'apply' | 'rollback' | null>(null);
  const operation = status.update?.operation;
  const mutation = useMutation({
    mutationFn: ({
      action,
      input,
    }: {
      action: 'plan' | 'apply' | 'rollback' | 'recover';
      input: Record<string, unknown>;
    }) => requestManagerUpdate(action, input),
    onSuccess: (result, variables) => {
      setPlan(variables.action === 'plan' ? result : null);
      setConfirm(
        variables.action === 'plan' && result.applicable ? 'apply' : null,
      );
      void client.invalidateQueries({ queryKey: managerStatusQueryKey });
    },
  });
  const busy = status.update?.busy || mutation.isPending;
  const blocked = operation?.status === 'recoveryRequired';
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h3 className="text-sm font-semibold">{t('managerUpdateAction')}</h3>
      <p className="text-xs text-muted-foreground">
        {t('managerUpdateSafetyDescription')}
      </p>
      {operation && (
        <div
          role="status"
          className="space-y-2 rounded-lg border border-border p-3 text-sm"
        >
          <p className="font-medium">
            {t(
              translationKey(
                statuses[operation.status] ?? 'managerUpdateRunning',
              ),
            )}
          </p>
          <p>
            {t(
              translationKey(
                phases[operation.phase] ?? 'managerUpdatePreparing',
              ),
            )}
          </p>
          {operation.backupRetained && (
            <p className="text-xs text-muted-foreground">
              {t('managerUpdateBackupRetained')}
            </p>
          )}
          {operation.error && (
            <p className="text-destructive">
              {t(translationKey(operation.error))}
            </p>
          )}
          <details className="text-xs">
            <summary className="cursor-pointer">
              {t('managerUpdateJournal')}
            </summary>
            <ol className="mt-2 space-y-1">
              {operation.events.map((event, index) => (
                <li key={index}>
                  {new Date(event.at).toLocaleString(i18n.language)} ·{' '}
                  {t(
                    translationKey(
                      phases[event.phase] ?? 'managerUpdatePreparing',
                    ),
                  )}
                </li>
              ))}
            </ol>
          </details>
          {operation.status === 'succeeded' && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirm('rollback')}
            >
              {t('managerRestorePreviousVersion')}
            </Button>
          )}
          {blocked && (
            <Button
              disabled={busy}
              onClick={() =>
                mutation.mutate({
                  action: 'recover',
                  input: { confirmation: 'RETRY_RECOVERY' },
                })
              }
            >
              {t('managerRetryRecovery')}
            </Button>
          )}
        </div>
      )}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {t('managerUpdateSeparateFromSettings')}
        </p>
        <p className="break-all font-mono text-xs">{image}</p>
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {t('managerAdvancedImage')}
          </summary>
          <div className="mt-2 space-y-2">
            <label htmlFor="manager-update-image" className="text-sm">
              {t('managerTargetApplicationImage')}
            </label>
            <Input
              id="manager-update-image"
              value={image}
              disabled={busy || blocked}
              onChange={(event) => {
                setManualSelection(true);
                setImage(event.target.value);
                setPlan(null);
              }}
            />
          </div>
        </details>
        <Button
          type="button"
          disabled={
            busy ||
            blocked ||
            !image.trim() ||
            (!manualSelection &&
              (!release.data ||
                release.isError ||
                (!!release.data.targetImage && !release.data.updateAvailable)))
          }
          onClick={() => {
            // Keep the reviewed target fixed if release discovery finishes later.
            setImage(image.trim());
            const target =
              !manualSelection &&
              release.data?.targetDigest &&
              release.data.targetImage === image
                ? `ghcr.io/maxhugit/mergeron@${release.data.targetDigest}`
                : image.trim();
            mutation.mutate({
              action: 'plan',
              input: { images: { application: target } },
            });
          }}
        >
          {mutation.isPending
            ? t('managerCheckingPrerequisites')
            : t('managerPrepareUpdate')}
        </Button>
      </div>
      {plan && (
        <div className="space-y-2 text-sm">
          <p className="break-all font-mono text-xs">
            {plan.images.application}
          </p>
          {!plan.applicable && (
            <p role="alert">
              {t('managerUpdateBlocked')}{' '}
              <span className="text-xs">{plan.blockers.join(', ')}</span>
            </p>
          )}
        </div>
      )}
      {mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {t(translationKey(mutation.error.message))}
        </p>
      )}
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                confirm === 'rollback'
                  ? 'managerRestorePreviousVersion'
                  : 'managerStartUpdate',
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'apply' && plan && (
                <span className="mb-2 block break-all font-mono text-xs">
                  {plan.images.application}
                </span>
              )}
              {t(
                confirm === 'rollback'
                  ? 'managerRollbackDataWarning'
                  : 'managerUpdateDowntimeWarning',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{common('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => {
                if (confirm === 'apply' && plan)
                  mutation.mutate({
                    action: 'apply',
                    input: {
                      images: plan.images,
                      confirmation: 'UPDATE_WITH_ROLLBACK',
                      expectedFingerprint: plan.fingerprint,
                    },
                  });
                if (confirm === 'rollback' && operation)
                  mutation.mutate({
                    action: 'rollback',
                    input: {
                      operationId: operation.id,
                      confirmation: 'ROLLBACK_WITH_DATA_RESTORE',
                    },
                  });
              }}
            >
              {confirm === 'apply'
                ? t('managerConfirmUpdate')
                : common('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
