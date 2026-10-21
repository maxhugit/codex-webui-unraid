import { useTranslation } from 'react-i18next';

/** Human-readable suggestion; review state remains authoritative in project settings. */
export function MemoryProposalMessage({
  text,
  completed,
}: {
  text: string;
  completed: boolean;
}) {
  const { t } = useTranslation();
  let proposal: { title?: unknown; file?: unknown; text?: unknown } | null =
    null;
  try {
    proposal = JSON.parse(text) as {
      title?: unknown;
      file?: unknown;
      text?: unknown;
    } | null;
  } catch {
    /* Streaming JSON may be incomplete. */
  }
  return (
    <aside className="my-3 space-y-2 rounded-lg border bg-muted/30 p-3">
      <p className="font-medium">{t('memorySuggestion')}</p>
      {proposal &&
      typeof proposal.title === 'string' &&
      typeof proposal.text === 'string' ? (
        <>
          <p className="text-sm">{proposal.title}</p>
          {typeof proposal.file === 'string' && (
            <p className="font-mono text-xs text-muted-foreground">
              {proposal.file}
            </p>
          )}
          <p className="whitespace-pre-wrap text-sm">{proposal.text}</p>
          <p className="text-xs text-muted-foreground">
            {t(
              'reviewThisSuggestionInTheProjectKnowledgeTabSharedMemoryIsOnlyUpdatedAfterAcceptance',
            )}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {completed
            ? t(
                'thisMemorySuggestionCouldNotBeReadAskTheConversationToProposeItAgain',
              )
            : t('preparingMemorySuggestion')}
        </p>
      )}
    </aside>
  );
}
