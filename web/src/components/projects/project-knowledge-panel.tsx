import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { projectsApi } from '@/lib/projects-api';

const names = ['AGENTS.md', 'CONNAISSANCES.md', 'DECISIONS.md'] as const;
type Files = Record<(typeof names)[number], string>;
type Snapshot = { files: Files; revision: string; path: string };
type Draft = { files: Files; revision: string };
const labels = [
  'Shared instructions',
  'Project knowledge',
  'Project decisions',
];
const descriptions = [
  'Stable rules and ways of working for all conversations in this project.',
  'Useful facts, definitions and references shared by the project.',
  'Agreed decisions, their reasons and any conditions for reconsidering them.',
];

export function ProjectKnowledgePanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const key = ['project-knowledge', projectId];
  const draftKey = ['project-knowledge-draft', projectId];
  // Retain drafts when switching project tabs, with their original revision.
  const [draft, setDraft] = useState<Draft | null>(() => {
    client.setQueryDefaults(['project-knowledge-draft'], { gcTime: Infinity });
    return client.getQueryData<Draft | null>(draftKey) ?? null;
  });
  const [reloadError, setReloadError] = useState('');
  const query = useQuery({
    queryKey: key,
    queryFn: () => projectsApi<Snapshot>(`/${projectId}/knowledge`),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const save = useMutation({
    mutationFn: (input: Draft) =>
      projectsApi<Snapshot>(`/${projectId}/knowledge`, {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    onSuccess: (snapshot) => {
      client.setQueryData(key, snapshot);
      client.setQueryData(draftKey, null);
      setDraft(null);
    },
  });
  const snapshot = query.data;
  const files = draft?.files ?? snapshot?.files;
  const dirty =
    !!files &&
    !!snapshot &&
    names.some((name) => files[name] !== snapshot.files[name]);
  const tooLarge =
    !!files &&
    names.some((name) => new TextEncoder().encode(files[name]).length > 32768);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const reload = async () => {
    setReloadError('');
    const result = await query.refetch();
    if (result.error) setReloadError(result.error.message);
    else {
      client.setQueryData(draftKey, null);
      setDraft(null);
      save.reset();
    }
  };
  if (!snapshot || !files)
    return (
      <div role={query.error ? 'alert' : 'status'}>
        {query.error ? t('Unable to load project knowledge') : t('Loading…')}
        {query.error && (
          <Button onClick={() => void reload()}>{t('Retry')}</Button>
        )}
      </div>
    );
  return (
    <section className="space-y-5 pb-3">
      <div>
        <h3 className="font-semibold">{t('Shared project knowledge')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            'These files are read at each new exchange, including in secondary workspaces. Saved changes apply to the next exchange; a response already in progress keeps its current context.',
          )}
        </p>
        <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
          {snapshot.path}
        </p>
      </div>
      {names.map((name, index) => (
        <div key={name} className="space-y-2 rounded-lg border p-3">
          <label htmlFor={`knowledge-${name}`} className="block font-medium">
            {t(labels[index])}{' '}
            <span className="font-mono text-xs text-muted-foreground">
              {name}
            </span>
          </label>
          <p className="text-sm text-muted-foreground">
            {t(descriptions[index])}
          </p>
          <Textarea
            id={`knowledge-${name}`}
            rows={8}
            value={files[name]}
            disabled={save.isPending}
            className="font-mono text-sm"
            onChange={(event) => {
              const next = {
                files: { ...files, [name]: event.target.value },
                revision: draft?.revision ?? snapshot.revision,
              };
              setDraft(next);
              client.setQueryData<Draft>(draftKey, next);
            }}
          />
          <p className="text-xs text-muted-foreground">
            {new TextEncoder().encode(files[name]).length} / 32768 {t('bytes')}
          </p>
        </div>
      ))}
      {save.error && (
        <p role="alert" className="text-sm text-destructive">
          {t(
            'Unable to save project knowledge. If another edit was saved, reload before trying again. Your draft has been kept.',
          )}{' '}
        </p>
      )}
      {reloadError && (
        <p role="alert" className="text-sm text-destructive">
          {t('Unable to load project knowledge')}
        </p>
      )}
      {tooLarge && (
        <p role="alert" className="text-sm text-destructive">
          {t('Each knowledge file is limited to 32 KiB of UTF-8 text.')}
        </p>
      )}
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 border-t bg-background py-3">
        <span role="status" className="text-sm text-muted-foreground">
          {dirty ? t('Unsaved changes') : t('No pending changes')}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={save.isPending || query.isFetching}
            onClick={() => void reload()}
          >
            {dirty ? t('Reload and discard changes') : t('Reload')}
          </Button>
          <Button
            disabled={!dirty || tooLarge || save.isPending}
            onClick={() =>
              save.mutate({
                files,
                revision: draft?.revision ?? snapshot.revision,
              })
            }
          >
            {save.isPending ? t('Saving…') : t('Save')}
          </Button>
        </div>
      </div>
    </section>
  );
}
