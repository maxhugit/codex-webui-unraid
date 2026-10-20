import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { projectsApi } from '@/lib/projects-api';
import { withBasePath } from '@/base-path';

interface Proposal {
  id: string;
  title: string;
  file: string;
  status: 'pending' | 'accepted' | 'rejected';
  version: number;
  sourceType: 'agent' | 'simple';
  threadId: string;
  createdAt: number;
  reviewedAt: number | null;
  reviewer: string | null;
  baseRevision: string;
}
interface Detail extends Proposal {
  baseFiles: Record<string, string>;
  proposedFiles: Record<string, string>;
}

export function KnowledgeProposalsPanel({
  projectId,
  revision,
  unsaved,
  onApplied,
  onBusyChange,
}: {
  projectId: string;
  revision: string;
  unsaved: boolean;
  onApplied: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const listKey = ['knowledge-proposals', projectId];
  const detailKey = ['knowledge-proposal', projectId, selected];
  const query = useQuery({
    queryKey: [...listKey, offset],
    queryFn: () =>
      projectsApi<{ proposals: Proposal[]; nextOffset: number | null }>(
        `/${projectId}/knowledge/proposals?offset=${offset}`,
      ),
    refetchInterval: 10000,
    refetchOnWindowFocus: false,
  });
  const detail = useQuery({
    queryKey: detailKey,
    queryFn: () =>
      projectsApi<Detail>(`/${projectId}/knowledge/proposals/${selected}`),
    enabled: !!selected,
    refetchOnWindowFocus: false,
  });
  const review = useMutation({
    mutationFn: ({
      action,
      proposal,
    }: {
      action: 'edit' | 'accept' | 'reject';
      proposal: Detail;
    }) =>
      projectsApi<Detail>(`/${projectId}/knowledge/proposals/${proposal.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          action,
          version: proposal.version,
          ...(action === 'edit'
            ? { content: content ?? proposal.proposedFiles[proposal.file] }
            : {}),
        }),
      }),
    onSuccess: async (proposal, input) => {
      client.setQueryData(
        ['knowledge-proposal', projectId, proposal.id],
        proposal,
      );
      setContent(null);
      await client.invalidateQueries({ queryKey: listKey });
      if (input.action === 'accept') onApplied();
    },
  });
  const proposal = detail.data;
  useEffect(() => {
    onBusyChange?.(review.isPending);
    return () => onBusyChange?.(false);
  }, [review.isPending, onBusyChange]);
  const proposed =
    (proposal?.status === 'pending' ? content : null) ??
    proposal?.proposedFiles[proposal.file] ??
    '';
  const changed =
    !!proposal && proposed !== proposal.proposedFiles[proposal.file];
  const stale = !!proposal && proposal.baseRevision !== revision;
  const tooLarge = new TextEncoder().encode(proposed).length > 32768;
  const date = (value: number) => new Date(value).toLocaleString(i18n.language);
  return (
    <section className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{t('Memory proposals')}</h3>
        <Button
          variant="outline"
          disabled={query.isFetching || review.isPending}
          onClick={() => {
            void query.refetch();
            if (selected) void detail.refetch();
          }}
        >
          {t('Reload')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {t(
          'Agents can suggest lasting facts or decisions. Only accepted proposals change shared knowledge. You can ask a conversation to propose a memory update.',
        )}
      </p>
      {query.error && (
        <p role="alert">{t('Unable to load memory proposals')}</p>
      )}
      {!query.isPending && !query.error && !query.data?.proposals?.length && (
        <p className="text-sm text-muted-foreground">
          {t('No memory proposals')}
        </p>
      )}
      {(query.data?.proposals ?? []).map((item) => (
        <div key={item.id} className="rounded-lg border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>{item.title}</strong>
            <span className="text-xs">
              {t(
                item.status === 'pending'
                  ? 'Pending review'
                  : item.status === 'accepted'
                    ? 'Accepted'
                    : 'Rejected',
              )}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.file} · {date(item.createdAt)}
          </p>
          <a
            className="mt-1 block break-all text-sm underline"
            href={withBasePath(
              item.sourceType === 'agent'
                ? `/t/${encodeURIComponent(item.threadId)}`
                : `/simple-chat?thread=${encodeURIComponent(item.threadId)}`,
            )}
          >
            {t('Open source conversation')} · {item.threadId}
          </a>
          {item.reviewedAt && (
            <p className="text-xs text-muted-foreground">
              {item.reviewer} · {date(item.reviewedAt)}
            </p>
          )}
          <Button
            variant="ghost"
            disabled={review.isPending}
            onClick={() => {
              setSelected(selected === item.id ? null : item.id);
              setContent(null);
              review.reset();
            }}
          >
            {selected === item.id ? t('Close') : t('Review proposal')}
          </Button>
          {selected === item.id && detail.isPending && (
            <p role="status">{t('Loading…')}</p>
          )}
          {selected === item.id && detail.error && (
            <p role="alert">{t('Unable to load memory proposals')}</p>
          )}
          {selected === item.id && proposal && (
            <div className="mt-3 space-y-3">
              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <label
                    htmlFor={`before-${item.id}`}
                    className="text-sm font-medium"
                  >
                    {t('Before proposal')}
                  </label>
                  <Textarea
                    id={`before-${item.id}`}
                    readOnly
                    rows={8}
                    value={proposal.baseFiles[proposal.file]}
                    className="font-mono text-xs"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`after-${item.id}`}
                    className="text-sm font-medium"
                  >
                    {t('Proposed content')}
                  </label>
                  <Textarea
                    id={`after-${item.id}`}
                    readOnly={proposal.status !== 'pending'}
                    disabled={review.isPending}
                    rows={8}
                    value={proposed}
                    onChange={(event) => setContent(event.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
              </div>
              {stale && proposal.status === 'pending' && (
                <p role="alert" className="text-sm text-destructive">
                  {t(
                    'Shared knowledge has changed. Reject this outdated proposal and ask the conversation for a new proposal based on the current knowledge.',
                  )}
                </p>
              )}
              {unsaved && (
                <p className="text-sm text-muted-foreground">
                  {t(
                    'Save or discard your knowledge draft before accepting a proposal.',
                  )}
                </p>
              )}
              {tooLarge && (
                <p role="alert">
                  {t('Each knowledge file is limited to 32 KiB of UTF-8 text.')}
                </p>
              )}
              {review.error && (
                <p role="alert" className="text-sm text-destructive">
                  {t(
                    'The proposal could not be updated. Reload to check its version; your local changes have been kept.',
                  )}
                </p>
              )}
              {proposal.status === 'pending' && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={!changed || tooLarge || review.isPending}
                    onClick={() => review.mutate({ action: 'edit', proposal })}
                  >
                    {t('Save proposal changes')}
                  </Button>
                  <Button
                    disabled={changed || stale || unsaved || review.isPending}
                    onClick={() =>
                      review.mutate({ action: 'accept', proposal })
                    }
                  >
                    {t('Accept and apply')}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={review.isPending}
                    onClick={() =>
                      review.mutate({ action: 'reject', proposal })
                    }
                  >
                    {t('Reject')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          variant="ghost"
          disabled={!offset || review.isPending}
          onClick={() => {
            setOffset(Math.max(0, offset - 50));
            setSelected(null);
          }}
        >
          {t('Previous')}
        </Button>
        <Button
          variant="ghost"
          disabled={query.data?.nextOffset == null || review.isPending}
          onClick={() => {
            setOffset(query.data?.nextOffset ?? offset);
            setSelected(null);
          }}
        >
          {t('Next')}
        </Button>
      </div>
    </section>
  );
}
