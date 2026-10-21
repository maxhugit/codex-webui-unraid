import { translationKey } from '@/locales/translation-key';
/**
 * What is currently preventing a catalog restart, and what to do about it.
 *
 * A blocker with no way out is worse than no blocker at all, so each reason is
 * paired with the action that clears it. Some retained work has no observable
 * terminal signal upstream and is only released when the thread closes or the
 * process restarts — saying so plainly beats letting the user retry forever.
 */
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import { Info, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CatalogBlockerDto, CatalogBlockersDto } from '@/generated/api';

/**
 * Maps a blocker to the action that actually resolves it.
 *
 * Two of these have no in-app remedy, and saying otherwise is worse than saying
 * nothing: the backend keeps `thread/shellCommand` and an activated
 * `thread/goal/set` reserved because upstream exposes no terminal signal for
 * either, and nothing in this app sends an upstream thread close — pausing the
 * goal or closing the conversation in the browser leaves the reservation
 * standing. Only Codex unloading the thread or the process restarting clears
 * them.
 */
function escapeHint(blocker: CatalogBlockerDto): string {
  if (blocker.processIds?.length) return 'Stop the background terminal first.';
  if (blocker.requestMethod === 'thread/shellCommand')
    return 'A `!` shell command ran here and Codex reports no completion for it. It clears when Codex unloads this conversation or the app-server is restarted from the server side.';
  if (blocker.requestMethod === 'thread/goal/set')
    return 'A goal was activated here. Pausing it does not retract work already dispatched, so this clears when Codex unloads this conversation or the app-server is restarted from the server side.';
  if (blocker.requestMethod)
    return 'Wait for this work to finish, or interrupt it in the conversation.';
  if (blocker.reason.includes('queued'))
    return 'Clear the queued messages in this conversation.';
  return 'Wait for this conversation to finish, or interrupt it.';
}

export function CatalogBlockerList({
  query,
}: {
  query: UseQueryResult<CatalogBlockersDto>;
}) {
  const { t } = useTranslation();
  const data = query.data;
  if (!data) return null;

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">
          {data.canApply
            ? t('noWorkIsBlockingARestart')
            : t('countBlockersPreventARestart', {
                count: data.blockers.length,
              })}
        </p>
        <Button
          size="sm"
          variant="ghost"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          {t('reCheck')}
        </Button>
      </div>

      {data.blockers.length > 0 && (
        <ul className="space-y-1.5">
          {data.blockers.map((blocker, index) => (
            <li key={index} className="text-xs">
              <span className="font-medium">
                {blocker.name ?? blocker.threadId ?? t('server')}
              </span>
              {': '}
              <span className="text-muted-foreground">{blocker.reason}</span>
              <p className="text-muted-foreground/80">
                {t(translationKey(escapeHint(blocker)))}
              </p>
            </li>
          ))}
        </ul>
      )}

      {/*
        The check covers this backend's own app-server and the work it
        dispatched. It cannot see a CLI session running against the same Codex
        home, so it must not be presented as proof that nothing is running. The
        backend enumerates what its scope excludes; rendering that list rather
        than a fixed sentence keeps the caveat honest as the scope changes.
      */}
      <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        <div className="space-y-0.5">
          <p>
            {t(
              'coversThisCodexProcessAndTheWorkThisServerStartedAnotherClientUsingTheSameCodex019b2623',
            )}
          </p>
          {data.limitations.map((limitation, index) => (
            <p key={index}>{limitation}</p>
          ))}
        </div>
      </div>
    </div>
  );
}
