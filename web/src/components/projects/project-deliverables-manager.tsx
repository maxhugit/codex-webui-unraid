import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { usePlatformSession } from '@/lib/platform-session';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { projectsApi } from '@/lib/projects-api';
import type {
  Deliverable,
  DeliverablesBoard,
  DeliverableVersion,
} from '@/lib/deliverables-api';
import { withBasePath } from '@/base-path';
import { getAuthorizationHeader } from '@/auth-token';

const statuses = {
  planned: 'To produce',
  in_progress: 'In progress',
  review: 'Awaiting validation',
  validated: 'Validated',
};
export function ProjectDeliverablesManager({
  projectId,
  resourceId,
}: {
  projectId: string;
  resourceId: string;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const key = ['project-deliverables', projectId, resourceId];
  const base = `/${projectId}/resources/${resourceId}/deliverables`;
  const query = useQuery({
    queryKey: key,
    queryFn: () => projectsApi<DeliverablesBoard>(base),
    refetchOnWindowFocus: false,
  });
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const canLeave = () =>
    !dirty || window.confirm(t('Discard unsaved deliverable changes?'));
  const create = useMutation({
    mutationFn: () =>
      projectsApi<Deliverable>(base, {
        method: 'POST',
        body: JSON.stringify({ title }),
      }),
    onSuccess: async (item) => {
      setTitle('');
      setSelected(item.id);
      await client.invalidateQueries({ queryKey: key });
    },
  });
  const board = query.data;
  if (!board)
    return (
      <main className="p-6" role={query.error ? 'alert' : 'status'}>
        {query.error ? t('Unable to load deliverables') : t('Loading…')}
      </main>
    );
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 md:p-6">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <h1 className="text-xl font-semibold">{board.resource.name}</h1>
        <p className="text-sm text-muted-foreground">
          {t(
            'Track expected outputs, working files and validated versions. Removing this manager preserves its files.',
          )}
        </p>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim() && canLeave()) create.mutate();
          }}
        >
          <Input
            aria-label={t('New deliverable title')}
            value={title}
            maxLength={160}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('New deliverable title')}
          />
          <Button disabled={!title.trim() || create.isPending}>
            {t('Add deliverable')}
          </Button>
        </form>
        {create.error && (
          <p role="alert" className="text-sm text-destructive">
            {t('Unable to save deliverable')}
          </p>
        )}
        {!board.deliverables.length && (
          <p className="text-muted-foreground">{t('No deliverables yet')}</p>
        )}
        <div className="grid gap-4 lg:grid-cols-[minmax(200px,1fr)_minmax(0,3fr)]">
          <div className="space-y-2">
            {board.deliverables.map((item) => (
              <button
                key={item.id}
                className={`w-full space-y-1 rounded-lg border p-3 text-left ${selected === item.id ? 'bg-accent' : ''}`}
                onClick={() => {
                  if (selected !== item.id && canLeave()) setSelected(item.id);
                }}
              >
                <strong className="block break-words">{item.title}</strong>
                <span className="block text-xs text-muted-foreground">
                  {t(statuses[item.status])} ·{' '}
                  {board.assignees.find((p) => p.id === item.assigneeId)
                    ?.name ?? t('Unassigned')}
                </span>
                {item.dueAt !== null && (
                  <span className="block text-xs">
                    {t('Due date')}:{' '}
                    {new Date(item.dueAt).toLocaleDateString(undefined, {
                      timeZone: 'UTC',
                    })}
                  </span>
                )}
              </button>
            ))}
          </div>
          {board.deliverables
            .filter((item) => item.id === selected)
            .map((item) => (
              <DeliverableEditor
                key={`${item.id}:${item.version}`}
                item={item}
                board={board}
                base={base}
                refresh={() => client.invalidateQueries({ queryKey: key })}
                onRemoved={() => setSelected(null)}
                onDirty={setDirty}
              />
            ))}
        </div>
      </div>
    </main>
  );
}

function DeliverableEditor({
  item,
  board,
  base,
  refresh,
  onRemoved,
  onDirty,
}: {
  item: Deliverable;
  board: DeliverablesBoard;
  base: string;
  refresh: () => Promise<unknown>;
  onRemoved: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = usePlatformSession();
  const [draft, setDraft] = useState({
    title: item.title,
    description: item.description,
    criteria: item.criteria,
    assigneeId: item.assigneeId ?? '',
    dueAt:
      item.dueAt === null
        ? ''
        : new Date(item.dueAt).toISOString().slice(0, 10),
    status: item.status,
    taskIds: item.taskIds,
    conversations: item.conversations,
  });
  const [paths, setPaths] = useState(''),
    [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [revisionDirty, setRevisionDirty] = useState(false);
  useEffect(() => {
    onDirty(revisionDirty || !!paths.trim() || !!note.trim());
    return () => onDirty(false);
  }, [revisionDirty, paths, note, onDirty]);
  const fail = () =>
    setError(
      t(
        'The deliverable could not be updated. Reload to check for concurrent changes.',
      ),
    );
  const action = useMutation({
    mutationFn: ({
      suffix = '',
      method = 'POST',
      body,
    }: {
      suffix?: string;
      method?: string;
      body: unknown;
    }) =>
      projectsApi(`${base}/${item.id}${suffix}`, {
        method,
        body: JSON.stringify(body),
      }),
    onSuccess: async (_, input) => {
      if (input.method === 'DELETE') onRemoved();
      await refresh();
    },
    onError: fail,
  });
  const upload = useMutation({
    mutationFn: async (files: FileList) => {
      const form = new FormData();
      for (const file of Array.from(files))
        form.append('files', file, file.name);
      const authorization = getAuthorizationHeader();
      const response = await fetch(
        withBasePath(
          `/api/files/upload?destinationPath=${encodeURIComponent(item.directory)}&overwrite=true`,
        ),
        {
          method: 'POST',
          headers: authorization ? { Authorization: authorization } : {},
          body: form,
        },
      );
      if (!response.ok) throw new Error('Upload failed');
      return response.json() as Promise<{ files: Array<{ path: string }> }>;
    },
    onSuccess: (result) =>
      setPaths(result.files.map((file) => file.path).join('\n')),
    onError: fail,
  });
  const agent = useMutation({
    mutationFn: () =>
      projectsApi<{ threadId: string }>(`${base}/${item.id}/agent`, {
        method: 'POST',
        body: JSON.stringify({ version: item.version }),
      }),
    onSuccess: async ({ threadId }) => {
      await refresh();
      await navigate({ to: '/t/$threadId', params: { threadId } });
    },
    onError: fail,
  });
  const busy = action.isPending || upload.isPending || agent.isPending;
  const set = <K extends keyof typeof draft>(
    key: K,
    value: (typeof draft)[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setRevisionDirty(true);
  };
  const download = async (version: DeliverableVersion, index: number) => {
    try {
      const authorization = getAuthorizationHeader();
      const response = await fetch(
        withBasePath(
          `/api/projects${base}/${item.id}/versions/${version.id}/files/${index}`,
        ),
        { headers: authorization ? { Authorization: authorization } : {} },
      );
      if (!response.ok) {
        fail();
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = version.files[index].name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      fail();
    }
  };
  return (
    <section className="min-w-0 space-y-4 rounded-xl border p-4">
      {session.isAdministrator && (
        <Button
          variant="outline"
          disabled={busy || revisionDirty || !!paths.trim() || !!note.trim()}
          onClick={() => agent.mutate()}
        >
          {t('Work on this deliverable')}
        </Button>
      )}
      <div className="space-y-2">
        <label htmlFor="deliverable-title">{t('Title')}</label>
        <Input
          id="deliverable-title"
          disabled={busy}
          value={draft.title}
          onChange={(e) => set('title', e.target.value)}
          maxLength={160}
        />
        <label className="block" htmlFor="deliverable-description">
          {t('Description')}
        </label>
        <Textarea
          id="deliverable-description"
          disabled={busy}
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
        />
        <label className="block" htmlFor="deliverable-criteria">
          {t('Validation criteria')}
        </label>
        <Textarea
          id="deliverable-criteria"
          disabled={busy}
          value={draft.criteria}
          onChange={(e) => set('criteria', e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <label>
            {t('Responsible person')}
            <select
              className="mt-1 w-full rounded border bg-background p-2 text-sm"
              disabled={busy}
              value={draft.assigneeId}
              onChange={(e) => set('assigneeId', e.target.value)}
            >
              <option value="">{t('Unassigned')}</option>
              {board.assignees.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('Due date')}
            <Input
              type="date"
              disabled={busy}
              value={draft.dueAt}
              onChange={(e) => set('dueAt', e.target.value)}
            />
          </label>
          <label>
            {t('Status')}
            <select
              className="mt-1 w-full rounded border bg-background p-2 text-sm"
              disabled={busy}
              value={draft.status}
              onChange={(e) =>
                set('status', e.target.value as typeof draft.status)
              }
            >
              {Object.entries(statuses)
                .filter(
                  ([value]) =>
                    value !== 'validated' || item.status === 'validated',
                )
                .map(([value, label]) => (
                  <option key={value} value={value}>
                    {t(label)}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </div>
      <p className="break-all font-mono text-xs text-muted-foreground">
        {item.directory}
      </p>
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          {t('Linked tasks and conversations')}
        </summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div>
            {board.tasks.map((task) => (
              <label key={task.id} className="flex gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={draft.taskIds.includes(task.id)}
                  onChange={(e) =>
                    set(
                      'taskIds',
                      e.target.checked
                        ? [...draft.taskIds, task.id]
                        : draft.taskIds.filter((id) => id !== task.id),
                    )
                  }
                />
                <a
                  className="underline"
                  href={withBasePath(
                    `/projects/${encodeURIComponent(base.split('/')[1])}/resources/${encodeURIComponent(task.resourceId)}?task=${encodeURIComponent(task.id)}`,
                  )}
                >
                  {task.title}
                </a>
              </label>
            ))}
          </div>
          <div>
            {board.conversations.map((conversation) => (
              <label
                key={`${conversation.type}:${conversation.id}`}
                className="flex gap-2 break-all text-sm"
              >
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={draft.conversations.some(
                    (c) =>
                      c.id === conversation.id && c.type === conversation.type,
                  )}
                  onChange={(e) =>
                    set(
                      'conversations',
                      e.target.checked
                        ? [
                            ...draft.conversations,
                            { id: conversation.id, type: conversation.type },
                          ]
                        : draft.conversations.filter(
                            (c) =>
                              c.id !== conversation.id ||
                              c.type !== conversation.type,
                          ),
                    )
                  }
                />
                <a
                  className="underline"
                  href={withBasePath(
                    conversation.type === 'agent'
                      ? `/t/${encodeURIComponent(conversation.id)}`
                      : `/simple-chat?thread=${encodeURIComponent(conversation.id)}`,
                  )}
                >
                  {conversation.title}
                </a>
              </label>
            ))}
          </div>
        </div>
      </details>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !revisionDirty || !draft.title.trim()}
          onClick={() =>
            action.mutate({
              method: 'PATCH',
              body: {
                ...draft,
                assigneeId: draft.assigneeId || null,
                dueAt: draft.dueAt
                  ? Date.parse(`${draft.dueAt}T00:00:00Z`)
                  : null,
                version: item.version,
              },
            })
          }
        >
          {t('Save')}
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                t(
                  'Remove this deliverable record and its version history? All files will be preserved.',
                ),
              )
            )
              action.mutate({
                method: 'DELETE',
                body: { version: item.version },
              });
          }}
        >
          {t('Remove record')}
        </Button>
      </div>
      <div className="space-y-2 border-t pt-4">
        <h2 className="font-semibold">{t('Propose a version')}</h2>
        <p className="text-sm text-muted-foreground">
          {t(
            'Save the record first. Submit existing project files or upload working files. A submitted version keeps a separate copy; validated copies are preserved.',
          )}
        </p>
        <label className="block text-sm">
          {t('Upload or replace working files')}
          <Input
            type="file"
            multiple
            disabled={busy || revisionDirty}
            onChange={(e) => {
              if (e.target.files?.length) upload.mutate(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <label className="block text-sm" htmlFor="deliverable-paths">
          {t('Project file paths, one per line')}
        </label>
        <Textarea
          id="deliverable-paths"
          className="font-mono text-xs"
          disabled={busy || revisionDirty}
          value={paths}
          onChange={(e) => setPaths(e.target.value)}
        />
        <label className="block text-sm" htmlFor="version-note">
          {t('Version note')}
        </label>
        <Input
          id="version-note"
          disabled={busy || revisionDirty}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          disabled={busy || revisionDirty || !paths.trim()}
          onClick={() =>
            action.mutate({
              suffix: '/versions',
              body: {
                paths: paths
                  .split('\n')
                  .map((p) => p.trim())
                  .filter(Boolean),
                note,
                version: item.version,
              },
            })
          }
        >
          {t('Submit version')}
        </Button>
      </div>
      <div className="space-y-3 border-t pt-4">
        <h2 className="font-semibold">{t('Version history')}</h2>
        {!item.versions.length && (
          <p className="text-sm text-muted-foreground">
            {t('No submitted versions')}
          </p>
        )}
        {item.versions.map((version) => (
          <div className="space-y-2 rounded border p-3" key={version.id}>
            <strong>
              V{version.number} ·{' '}
              {t(
                version.status === 'validated'
                  ? 'Validated'
                  : version.status === 'rejected'
                    ? 'Rejected'
                    : 'Awaiting validation',
              )}
              {item.validatedVersionId === version.id
                ? ` · ${t('Current validated version')}`
                : ''}
            </strong>
            <p className="text-xs text-muted-foreground">
              {new Date(version.createdAt).toLocaleString()}{' '}
              {version.reviewer && `· ${version.reviewer}`}
            </p>
            <p className="whitespace-pre-wrap text-sm">{version.note}</p>
            {version.files.map((file, index) => (
              <Button
                key={index}
                variant="ghost"
                disabled={busy}
                onClick={() => void download(version, index)}
              >
                {file.name} · {Math.ceil(file.size / 1024)} KiB
              </Button>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  busy ||
                  revisionDirty ||
                  item.validatedVersionId === version.id
                }
                onClick={() =>
                  action.mutate({
                    suffix: `/versions/${version.id}/review`,
                    body: { action: 'validate', version: item.version },
                  })
                }
              >
                {t('Validate this version')}
              </Button>
              {version.status === 'proposed' && (
                <Button
                  variant="outline"
                  disabled={busy || revisionDirty}
                  onClick={() =>
                    action.mutate({
                      suffix: `/versions/${version.id}/review`,
                      body: { action: 'reject', version: item.version },
                    })
                  }
                >
                  {t('Reject')}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
