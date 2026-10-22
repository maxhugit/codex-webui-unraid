import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  FileText,
  FolderOpen,
  History,
  Link2,
  ListFilter,
  Pencil,
  Plus,
  Search,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { projectsApi } from '@/lib/projects-api';
import type {
  Deliverable,
  DeliverablesBoard,
  DeliverableVersion,
} from '@/lib/deliverables-api';
import { translationKey } from '@/locales/translation-key';
import { usePlatformSession } from '@/lib/platform-session';
import { withBasePath } from '@/base-path';
import { getAuthorizationHeader } from '@/auth-token';
import { DeliverableDocuments } from './deliverable-documents';
import { ProjectTaskManager } from './project-task-manager';

const statuses = {
  planned: 'To produce',
  in_progress: 'In progress',
  review: 'Awaiting validation',
  validated: 'Validated',
} as const;
const lifecycleStatuses = {
  draft: 'Draft',
  in_constitution: 'In constitution',
  finalized: 'Finalized',
  archived: 'Archived',
} as const;
type DetailTab = 'overview' | 'documents' | 'validation' | 'history' | 'links';
type Draft = {
  title: string;
  description: string;
  criteria: string;
  status: Deliverable['status'];
  conversations: Deliverable['conversations'];
};
type DeliverableAction = {
  mutate: (input: { suffix?: string; method?: string; body: unknown }) => void;
};
type FileUploadAction = { mutate: (files: FileList) => void };

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
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [dirty, setDirty] = useState(false);
  const canLeave = () =>
    !dirty || window.confirm(t('discardUnsavedDeliverableChanges'));
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
  const visible = useMemo(
    () =>
      board?.deliverables.filter((item) => {
        const needle = search.trim().toLocaleLowerCase();
        return (
          (status === 'all' || item.lifecycleStatus === status) &&
          (!needle ||
            item.title.toLocaleLowerCase().includes(needle) ||
            item.description.toLocaleLowerCase().includes(needle))
        );
      }) ?? [],
    [board, search, status],
  );
  if (!board)
    return (
      <main className="p-6" role={query.error ? 'alert' : 'status'}>
        {query.error ? t('unableToLoadDeliverables') : t('loading')}
      </main>
    );
  const current = board.deliverables.find((item) => item.id === selected);
  if (current)
    return (
      <DeliverableDetail
        key={`${current.id}:${current.version}`}
        item={current}
        board={board}
        base={base}
        refresh={() => client.invalidateQueries({ queryKey: key })}
        onBack={() => {
          if (canLeave()) setSelected(null);
        }}
        onRemoved={() => setSelected(null)}
        onDirty={setDirty}
      />
    );
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl space-y-5 p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{t('deliverables')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('deliverablesListDescription', {
                resource: board.resource.name,
              })}
            </p>
          </div>
          <form
            className="flex w-full gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault();
              if (title.trim()) create.mutate();
            }}
          >
            <Input
              aria-label={t('newDeliverableTitle')}
              className="sm:w-64"
              value={title}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('newDeliverableTitle')}
            />
            <Button disabled={!title.trim() || create.isPending}>
              <Plus className="h-4 w-4" />
              {t('newDeliverable')}
            </Button>
          </form>
        </div>
        <div className="flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row">
          <label className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label={t('searchDeliverable')}
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('searchDeliverable')}
            />
          </label>
          <label className="flex items-center gap-2">
            <ListFilter className="h-4 w-4 text-muted-foreground" />
            <select
              aria-label={t('filterByStatus')}
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">{t('allStatuses')}</option>
              {Object.entries(lifecycleStatuses).map(([value, label]) => (
                <option key={value} value={value}>
                  {t(translationKey(label))}
                </option>
              ))}
            </select>
          </label>
        </div>
        {create.error && (
          <p role="alert" className="text-sm text-destructive">
            {t('unableToSaveDeliverable')}
          </p>
        )}
        {!visible.length ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
            {board.deliverables.length
              ? t('noDeliverableMatchesFilters')
              : t('noDeliverablesYet')}
          </div>
        ) : (
          <DeliverablesList
            items={visible}
            board={board}
            onSelect={setSelected}
          />
        )}
      </div>
    </main>
  );
}

function DeliverablesList({
  items,
  board,
  onSelect,
}: {
  items: Deliverable[];
  board: DeliverablesBoard;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="hidden grid-cols-[minmax(220px,2fr)_100px_150px_130px_minmax(160px,1fr)_150px] gap-3 border-b bg-muted/40 px-4 py-3 text-xs font-medium text-muted-foreground lg:grid">
        <span>{t('title')}</span>
        <span>{t('documents')}</span>
        <span>{t('status')}</span>
        <span>{t('validation')}</span>
        <span>{t('responsiblePerson')}</span>
        <span>{t('lastModified')}</span>
      </div>
      <div className="divide-y">
        {items.map((item) => {
          const task = board.tasks.find(
            (candidate) => candidate.id === item.primaryTaskId,
          );
          const assignee = task?.assigneeName ?? t('unassigned');
          const count = item.documents.filter(
            (document) => document.deletedAt === null,
          ).length;
          return (
            <button
              key={item.id}
              className="grid w-full gap-3 px-4 py-4 text-left transition-colors hover:bg-accent/60 lg:grid-cols-[minmax(220px,2fr)_100px_150px_130px_minmax(160px,1fr)_150px] lg:items-center"
              onClick={() => onSelect(item.id)}
            >
              <span className="min-w-0">
                <strong className="block truncate">{item.title}</strong>
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {item.description || t('noDescription')}
                </span>
              </span>
              <span className="flex items-center gap-2 text-sm">
                <FileText className="h-4 w-4 text-muted-foreground" />
                {count}
              </span>
              <LifecycleBadge status={item.lifecycleStatus} />
              <span className="flex items-center gap-2 text-sm">
                <CheckCircle2
                  className={`h-4 w-4 ${item.validatedVersionId ? 'text-emerald-600' : 'text-muted-foreground'}`}
                />
                {item.validatedVersionId ? t('validated') : t('notValidated')}
              </span>
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{assignee}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(item.updatedAt).toLocaleDateString()}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LifecycleBadge({
  status,
}: {
  status: Deliverable['lifecycleStatus'];
}) {
  const { t } = useTranslation();
  const color =
    status === 'finalized'
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
      : status === 'archived'
        ? 'bg-muted text-muted-foreground'
        : status === 'in_constitution'
          ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300'
          : 'bg-amber-500/15 text-amber-700 dark:text-amber-300';
  return (
    <span
      className={`w-fit rounded-full px-2.5 py-1 text-xs font-medium ${color}`}
    >
      {t(translationKey(lifecycleStatuses[status]))}
    </span>
  );
}

function LifecycleActions({
  item,
  busy,
  action,
}: {
  item: Deliverable;
  busy: boolean;
  action: DeliverableAction;
}) {
  const { t } = useTranslation();
  const targets: Partial<
    Record<
      Deliverable['lifecycleStatus'],
      Array<{
        target: Deliverable['lifecycleStatus'];
        label: string;
        variant?: 'default' | 'outline';
      }>
    >
  > = {
    draft: [
      { target: 'in_constitution', label: 'Start constitution' },
      { target: 'finalized', label: 'Finalize' },
    ],
    in_constitution: [
      { target: 'draft', label: 'Return to draft', variant: 'outline' },
      { target: 'finalized', label: 'Finalize' },
    ],
    finalized: [
      { target: 'in_constitution', label: 'Reopen', variant: 'outline' },
      { target: 'archived', label: 'Archive' },
    ],
    archived: [{ target: 'finalized', label: 'Unarchive' }],
  };
  return (
    <>
      {targets[item.lifecycleStatus]?.map(({ target, label, variant }) => (
        <Button
          key={target}
          variant={variant}
          disabled={
            busy ||
            (target === 'finalized' &&
              item.documents.every((document) => document.deletedAt !== null))
          }
          onClick={() =>
            action.mutate({
              suffix: '/lifecycle',
              body: { target, version: item.version },
            })
          }
        >
          {t(translationKey(label))}
        </Button>
      ))}
    </>
  );
}

function DeliverableDetail({
  item,
  board,
  base,
  refresh,
  onBack,
  onRemoved,
  onDirty,
}: {
  item: Deliverable;
  board: DeliverablesBoard;
  base: string;
  refresh: () => Promise<unknown>;
  onBack: () => void;
  onRemoved: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = usePlatformSession();
  const [tab, setTab] = useState<DetailTab>('overview');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState(item.title);
  const [draft, setDraft] = useState<Draft>({
    title: item.title,
    description: item.description,
    criteria: item.criteria,
    status: item.status,
    conversations: item.conversations,
  });
  const [paths, setPaths] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [revisionDirty, setRevisionDirty] = useState(false);
  useEffect(() => {
    onDirty(revisionDirty || !!paths.trim() || !!note.trim());
    return () => onDirty(false);
  }, [revisionDirty, paths, note, onDirty]);
  const fail = (failure?: unknown) =>
    setError(
      failure instanceof Error && failure.message
        ? failure.message
        : t('theDeliverableCouldNotBeUpdatedReloadToCheckForConcurrentChanges'),
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
      if (!response.ok) throw new Error('upload');
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
  const rename = useMutation({
    mutationFn: () =>
      projectsApi(`${base}/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: renameTitle.trim(),
          version: item.version,
        }),
      }),
    onSuccess: async () => {
      setRenameOpen(false);
      await refresh();
    },
    onError: fail,
  });
  const busy =
    action.isPending || upload.isPending || agent.isPending || rename.isPending;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
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
      if (!response.ok) throw new Error('download');
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
  const tabs: Array<{ id: DetailTab; label: string; icon: typeof FileText }> = [
    { id: 'overview', label: t('overview'), icon: FolderOpen },
    { id: 'documents', label: t('documents'), icon: FileText },
    { id: 'validation', label: t('validation'), icon: CheckCircle2 },
    { id: 'history', label: t('history'), icon: History },
    { id: 'links', label: t('tasksAndConversations'), icon: Link2 },
  ];
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto w-full max-w-7xl px-4 pt-4 md:px-6">
          <button
            className="mb-3 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
            {t('backToDeliverables')}
          </button>
          <div className="flex flex-wrap items-start justify-between gap-3 pb-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold">
                  {item.title}
                </h1>
                <LifecycleBadge status={item.lifecycleStatus} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('deliverableHeaderSummary', {
                  documents: item.documents.filter(
                    (document) => document.deletedAt === null,
                  ).length,
                  date: new Date(item.updatedAt).toLocaleDateString(),
                })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={
                  busy || revisionDirty || item.lifecycleStatus === 'archived'
                }
                onClick={() => {
                  setRenameTitle(item.title);
                  setRenameOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
                {t('renameDeliverable')}
              </Button>
              <LifecycleActions
                item={item}
                busy={busy || revisionDirty || !!paths.trim() || !!note.trim()}
                action={action}
              />
              {session.isAdministrator && (
                <Button
                  variant="outline"
                  disabled={
                    busy ||
                    revisionDirty ||
                    !!paths.trim() ||
                    !!note.trim() ||
                    item.lifecycleStatus === 'archived'
                  }
                  onClick={() => agent.mutate()}
                >
                  {t('workOnThisDeliverable')}
                </Button>
              )}
            </div>
          </div>
          <div
            className="flex gap-1 overflow-x-auto"
            role="tablist"
            aria-label={t('deliverableSections')}
          >
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-primary font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                onClick={() => setTab(id)}
              >
                <Icon className="h-4 w-4" />
                {label}
                {id === 'documents' && (
                  <span className="rounded-full bg-muted px-1.5 text-xs">
                    {
                      item.documents.filter(
                        (document) => document.deletedAt === null,
                      ).length
                    }
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
        {tab === 'overview' && (
          <Overview
            item={item}
            board={board}
            draft={draft}
            set={set}
            busy={busy || item.lifecycleStatus === 'archived'}
            dirty={revisionDirty}
            action={action}
          />
        )}
        {tab === 'documents' && (
          <div className="rounded-xl border bg-card p-4">
            <DeliverableDocuments
              item={item}
              base={base}
              disabled={
                busy ||
                revisionDirty ||
                !['draft', 'in_constitution'].includes(item.lifecycleStatus)
              }
              refresh={refresh}
              onError={fail}
            />
          </div>
        )}
        {(tab === 'validation' || tab === 'history') && (
          <VersionHistory
            mode={tab}
            item={item}
            busy={
              busy ||
              !['draft', 'in_constitution'].includes(item.lifecycleStatus)
            }
            dirty={revisionDirty}
            paths={paths}
            note={note}
            setPaths={setPaths}
            setNote={setNote}
            upload={upload}
            action={action}
            download={download}
          />
        )}
        {tab === 'links' && (
          <Links
            item={item}
            board={board}
            base={base}
            draft={draft}
            set={set}
            busy={busy || item.lifecycleStatus === 'archived'}
            refresh={refresh}
          />
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('renameDeliverable')}</DialogTitle>
            <DialogDescription>
              {t('renameDeliverableDescription')}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (renameTitle.trim() && renameTitle.trim() !== item.title)
                rename.mutate();
            }}
          >
            <Input
              autoFocus
              aria-label={t('deliverableName')}
              value={renameTitle}
              maxLength={160}
              onChange={(event) => setRenameTitle(event.target.value)}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameOpen(false)}
              >
                {t('cancel')}
              </Button>
              <Button
                disabled={
                  rename.isPending ||
                  !renameTitle.trim() ||
                  renameTitle.trim() === item.title
                }
              >
                {t('rename')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function Overview({
  item,
  board,
  draft,
  set,
  busy,
  dirty,
  action,
}: {
  item: Deliverable;
  board: DeliverablesBoard;
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  busy: boolean;
  dirty: boolean;
  action: DeliverableAction;
}) {
  const { t } = useTranslation();
  const primaryTask = board.tasks.find(
    (task) => task.id === item.primaryTaskId,
  );
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="space-y-4 rounded-xl border bg-card p-4 lg:col-span-2">
        <h2 className="font-semibold">{t('generalInformation')}</h2>
        <label className="block text-sm">
          {t('title')}
          <Input
            className="mt-1"
            disabled={busy}
            value={draft.title}
            onChange={(event) => set('title', event.target.value)}
          />
        </label>
        <label className="block text-sm">
          {t('description')}
          <Textarea
            className="mt-1"
            disabled={busy}
            value={draft.description}
            onChange={(event) => set('description', event.target.value)}
          />
        </label>
        <label className="block text-sm">
          {t('validationCriteria')}
          <Textarea
            className="mt-1"
            disabled={busy}
            value={draft.criteria}
            onChange={(event) => set('criteria', event.target.value)}
          />
        </label>
        <label className="block text-sm">
          {t('status')}
          <select
            className="mt-1 w-full rounded border bg-background p-2"
            disabled={busy}
            value={draft.status}
            onChange={(event) =>
              set('status', event.target.value as Draft['status'])
            }
          >
            {Object.entries(statuses)
              .filter(
                ([value]) =>
                  value !== 'validated' || item.status === 'validated',
              )
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {t(translationKey(label))}
                </option>
              ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          {t('planningInheritedFromPrimaryTask')}
        </p>
        <div className="flex gap-2">
          <Button
            disabled={busy || !dirty || !draft.title.trim()}
            onClick={() =>
              action.mutate({
                method: 'PATCH',
                body: { ...draft, version: item.version },
              })
            }
          >
            {t('save')}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  t(
                    'removeThisDeliverableRecordAndItsVersionHistoryAllFilesWillBePreserved',
                  ),
                )
              )
                action.mutate({
                  method: 'DELETE',
                  body: { version: item.version },
                });
            }}
          >
            {t('removeRecord')}
          </Button>
        </div>
      </section>
      <aside className="space-y-3">
        <Summary
          icon={FileText}
          title={t('documents')}
          value={String(
            item.documents.filter((document) => document.deletedAt === null)
              .length,
          )}
        />
        <Summary
          icon={CheckCircle2}
          title={t('validation')}
          value={item.validatedVersionId ? t('validated') : t('notValidated')}
        />
        <Summary
          icon={UserRound}
          title={t('responsiblePerson')}
          value={primaryTask?.assigneeName ?? t('unassigned')}
        />
        <Summary
          icon={CalendarDays}
          title={t('dueDate')}
          value={
            primaryTask?.dueAt
              ? new Date(primaryTask.dueAt).toLocaleDateString(undefined, {
                  timeZone: 'UTC',
                })
              : t('notDefined')
          }
        />
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 flex items-center gap-2 font-medium">
            <FolderOpen className="h-4 w-4" />
            {t('location')}
          </div>
          <p className="break-all font-mono text-xs text-muted-foreground">
            {item.directory}
          </p>
        </div>
      </aside>
    </div>
  );
}
function Summary({
  icon: Icon,
  title,
  value,
}: {
  icon: typeof FileText;
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" />
        {title}
      </div>
      <strong className="mt-2 block">{value}</strong>
    </div>
  );
}

function VersionHistory({
  mode,
  item,
  busy,
  dirty,
  paths,
  note,
  setPaths,
  setNote,
  upload,
  action,
  download,
}: {
  mode: 'validation' | 'history';
  item: Deliverable;
  busy: boolean;
  dirty: boolean;
  paths: string;
  note: string;
  setPaths: (value: string) => void;
  setNote: (value: string) => void;
  upload: FileUploadAction;
  action: DeliverableAction;
  download: (version: DeliverableVersion, index: number) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={
        mode === 'validation'
          ? 'grid gap-4 lg:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)]'
          : 'space-y-4'
      }
    >
      {mode === 'validation' && (
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="font-semibold">
            {t('submitDeliverableForValidation')}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t('submitDeliverableForValidationDescription')}
          </p>
          <label className="block text-sm">
            {t('uploadOrReplaceWorkingFiles')}
            <Input
              className="mt-1"
              type="file"
              multiple
              disabled={busy || dirty}
              onChange={(event) => {
                if (event.target.files?.length)
                  upload.mutate(event.target.files);
                event.target.value = '';
              }}
            />
          </label>
          <label className="block text-sm">
            {t('projectFilePathsOnePerLine')}
            <Textarea
              className="mt-1 font-mono text-xs"
              disabled={busy || dirty}
              value={paths}
              onChange={(event) => setPaths(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            {t('versionNote')}
            <Input
              className="mt-1"
              disabled={busy || dirty}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <Button
            disabled={busy || dirty || !paths.trim()}
            onClick={() =>
              action.mutate({
                suffix: '/versions',
                body: {
                  paths: paths
                    .split('\n')
                    .map((path) => path.trim())
                    .filter(Boolean),
                  note,
                  version: item.version,
                },
              })
            }
          >
            {t('submitDeliverableForValidation')}
          </Button>
        </section>
      )}
      <div className="space-y-4">
        {mode === 'history' && (
          <section className="space-y-3 rounded-xl border bg-card p-4">
            <h2 className="font-semibold">{t('lifecycleHistory')}</h2>
            {item.lifecycleEvents.map((event) => (
              <div
                key={event.id}
                className="flex flex-wrap justify-between gap-2 border-b pb-2 text-sm last:border-0"
              >
                <span>
                  {event.fromStatus
                    ? `${t(translationKey(lifecycleStatuses[event.fromStatus]))} → `
                    : ''}
                  {t(translationKey(lifecycleStatuses[event.toStatus]))} ·{' '}
                  {event.actorName}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(event.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </section>
        )}
        <section className="space-y-3 rounded-xl border bg-card p-4">
          <h2 className="font-semibold">{t('versionHistory')}</h2>
          {!item.versions.length && (
            <p className="text-sm text-muted-foreground">
              {t('noSubmittedVersions')}
            </p>
          )}
          {item.versions.map((version) => (
            <div className="space-y-2 rounded-lg border p-3" key={version.id}>
              <div className="flex justify-between gap-2">
                <strong>
                  V{version.number} ·{' '}
                  {t(
                    version.status === 'validated'
                      ? 'validated'
                      : version.status === 'rejected'
                        ? 'rejected'
                        : 'awaitingValidation',
                  )}
                </strong>
                <span className="text-xs text-muted-foreground">
                  {new Date(version.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="text-sm">{version.note}</p>
              <div className="flex flex-wrap gap-2">
                {version.files.map((file, index) => (
                  <Button
                    key={index}
                    variant="ghost"
                    onClick={() => void download(version, index)}
                  >
                    {file.name}
                  </Button>
                ))}
              </div>
              {mode === 'validation' && (
                <div className="flex gap-2">
                  <Button
                    disabled={
                      busy || dirty || item.validatedVersionId === version.id
                    }
                    onClick={() =>
                      action.mutate({
                        suffix: `/versions/${version.id}/review`,
                        body: { action: 'validate', version: item.version },
                      })
                    }
                  >
                    {t('validateThisVersion')}
                  </Button>
                  {version.status === 'proposed' && (
                    <Button
                      variant="outline"
                      disabled={busy || dirty}
                      onClick={() =>
                        action.mutate({
                          suffix: `/versions/${version.id}/review`,
                          body: { action: 'reject', version: item.version },
                        })
                      }
                    >
                      {t('reject')}
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function Links({
  item,
  board,
  base,
  draft,
  set,
  busy,
  refresh,
}: {
  item: Deliverable;
  board: DeliverablesBoard;
  base: string;
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  busy: boolean;
  refresh: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [taskId, setTaskId] = useState(item.primaryTaskId ?? '');
  const [newTaskTitle, setNewTaskTitle] = useState(item.title);
  const [openTask, setOpenTask] = useState<{
    id: string;
    resourceId: string;
  } | null>(null);
  const mainTasks = board.tasks.filter((task) => task.parentTaskId === null);
  const primaryTask = board.tasks.find(
    (task) => task.id === item.primaryTaskId,
  );
  const subtasks = board.tasks.filter(
    (task) => task.parentTaskId === item.primaryTaskId,
  );
  const link = useMutation({
    mutationFn: (primaryTaskId: string | null) =>
      projectsApi(`${base}/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ primaryTaskId, version: item.version }),
      }),
    onSuccess: () => refresh(),
  });
  const createTask = useMutation({
    mutationFn: async () => {
      const resourceId = board.taskManagers[0]?.id;
      if (!resourceId) throw new Error('No task manager');
      const result = await projectsApi<{ task: { id: string } }>(
        `/${base.split('/')[1]}/resources/${resourceId}/tasks`,
        { method: 'POST', body: JSON.stringify({ title: newTaskTitle }) },
      );
      await projectsApi(`${base}/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          primaryTaskId: result.task.id,
          version: item.version,
        }),
      });
    },
    onSuccess: () => refresh(),
  });
  return (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <div>
        <h2 className="font-semibold">{t('linkedTasksAndConversations')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('onePrimaryTaskPerDeliverable')}
        </p>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-3">
          <h3 className="font-medium">{t('primaryTask')}</h3>
          {board.taskManagers.length ? (
            <>
              <div className="flex gap-2">
                <select
                  aria-label={t('primaryTask')}
                  className="min-w-0 flex-1 rounded border bg-background p-2 text-sm"
                  disabled={busy || link.isPending}
                  value={taskId}
                  onChange={(event) => setTaskId(event.target.value)}
                >
                  <option value="">{t('noPrimaryTask')}</option>
                  {mainTasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
                </select>
                <Button
                  disabled={
                    busy ||
                    link.isPending ||
                    taskId === (item.primaryTaskId ?? '')
                  }
                  onClick={() => link.mutate(taskId || null)}
                >
                  {t('associate')}
                </Button>
              </div>
              <div className="flex gap-2">
                <Input
                  aria-label={t('newTaskTitle')}
                  disabled={busy || createTask.isPending}
                  value={newTaskTitle}
                  onChange={(event) => setNewTaskTitle(event.target.value)}
                />
                <Button
                  variant="outline"
                  disabled={
                    busy || createTask.isPending || !newTaskTitle.trim()
                  }
                  onClick={() => createTask.mutate()}
                >
                  <Plus className="h-4 w-4" />
                  {t('createTask')}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('noTaskManagerAvailable')}
            </p>
          )}
          {primaryTask && (
            <div className="rounded-lg border p-3 text-sm">
              <button
                type="button"
                className="block w-full rounded text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() =>
                  setOpenTask({
                    id: primaryTask.id,
                    resourceId: primaryTask.resourceId,
                  })
                }
              >
                <span className="font-medium underline">
                  {primaryTask.title}
                </span>
                <span className="mt-1 block text-muted-foreground">
                  {primaryTask.status} · {primaryTask.progress}% ·{' '}
                  {primaryTask.assigneeName ?? t('unassigned')}
                </span>
              </button>
              {subtasks.length > 0 && (
                <ul className="mt-3 space-y-1 border-t pt-2">
                  {subtasks.map((task) => (
                    <li key={task.id}>
                      <button
                        type="button"
                        className="underline"
                        onClick={() =>
                          setOpenTask({
                            id: task.id,
                            resourceId: task.resourceId,
                          })
                        }
                      >
                        {task.title}
                      </button>{' '}
                      · {task.progress}%
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {openTask && (
            <ProjectTaskManager
              projectId={base.split('/')[1]}
              resourceId={openTask.resourceId}
              initialTaskId={openTask.id}
              modalOnly
              onModalClose={() => setOpenTask(null)}
            />
          )}
        </div>
        <div className="space-y-2">
          <h3 className="font-medium">{t('conversations')}</h3>
          {board.conversations.map((conversation) => (
            <label
              key={`${conversation.type}:${conversation.id}`}
              className="flex gap-2 rounded-lg border p-3 text-sm"
            >
              <input
                type="checkbox"
                disabled={busy}
                checked={draft.conversations.some(
                  (current) =>
                    current.id === conversation.id &&
                    current.type === conversation.type,
                )}
                onChange={(event) =>
                  set(
                    'conversations',
                    event.target.checked
                      ? [
                          ...draft.conversations,
                          { id: conversation.id, type: conversation.type },
                        ]
                      : draft.conversations.filter(
                          (current) =>
                            current.id !== conversation.id ||
                            current.type !== conversation.type,
                        ),
                  )
                }
              />
              <a
                className="break-all underline"
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
    </section>
  );
}
