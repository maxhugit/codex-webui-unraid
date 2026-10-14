/**
 * Left sidebar: global actions (top) + workspace-grouped thread navigation.
 * Rendering is split into sidebar/ sub-components; this file orchestrates
 * state, queries, mutations, and view routing.
 */
import { useMemo, useState } from 'react';
import { FolderOpen, MessageCircle, Pencil, Puzzle, Plus, Settings, Terminal } from 'lucide-react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  threadsArchiveThreadMutation,
  threadsCompactThreadMutation,
  threadsForkThreadMutation,
  threadsListOverviewOptions,
  threadsSetThreadNameMutation,
  threadsStartThreadMutation,
  threadsUnarchiveThreadMutation,
} from '@/generated/api/@tanstack/react-query.gen';
import type { ThreadDto } from '@/generated/api';
import { selectSidebarRows } from '@/lib/sidebar-rows';
import { useTimelineStore } from '@/stores/timeline-store';
import { useLayoutStore } from '@/stores/layout-store';
import { cn } from '@/lib/utils';
import { getApiErrorMessage } from '@/lib/api-error';
import {
  invalidateBranchTreeMembersSoon,
  invalidateBranchTreesSoon,
  invalidateThreadListSoon,
} from '@/lib/query-invalidation';
import { BranchGraphDialog } from '@/components/branches/branch-graph-dialog';
import { DeleteConversationDialog } from '@/components/branches/delete-conversation-dialog';
import {
  adoptionBlockReason,
  buildDeleteRequestBody,
  useBranchAdoptionStatus,
  useDeletePreview,
  useDeleteThread,
} from '@/hooks/use-thread-deletion';
import type { ConfirmAction } from './sidebar/sidebar-types';
import { threadLabel, groupByWorkspace } from './sidebar/sidebar-types';
import { ThreadRow } from './sidebar/thread-row';
import { WorkspaceOverview } from './sidebar/workspace-overview';
import { WorkspaceDetail } from './sidebar/workspace-detail';
import { RenameDialog, ConfirmDialog } from './sidebar/sidebar-dialogs';
import { DirectoryPickerDialog } from './sidebar/directory-picker-dialog';
import { ForkGoalDialog } from './sidebar/fork-goal-dialog';
import { useForkWithGoal } from '@/hooks/use-fork-with-goal';
import { getAuthorizationHeader } from '@/auth-token';
import { withBasePath } from '@/base-path';

interface SimpleChatThread {
  id: string;
  title: string;
  model: string;
  updatedAt: number;
}

function simpleChatHeaders() {
  const authorization = getAuthorizationHeader();
  return {
    'Content-Type': 'application/json',
    ...(authorization ? { Authorization: authorization } : {}),
  };
}

async function simpleChatApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(withBasePath(`/api/simple-chat${path}`), {
    ...init,
    headers: { ...simpleChatHeaders(), ...init?.headers },
  });
  const payload = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
  return payload;
}

/** Derives the active "view" from the current route path. */
function useActiveView(): 'chat' | 'simpleChat' | 'files' | 'terminal' | 'diagnostics' | 'settings' | 'integrations' | 'other' {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname.startsWith('/files')) return 'files';
  if (pathname.startsWith('/terminal')) return 'terminal';
  if (pathname.startsWith('/diagnostics')) return 'diagnostics';
  if (pathname.startsWith('/integrations')) return 'integrations';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/simple-chat')) return 'simpleChat';
  if (pathname === '/' || pathname.startsWith('/t/')) return 'chat';
  return 'other';
}

export function ThreadSidebar() {
  const navigate = useNavigate();
  const activeView = useActiveView();
  const activeSimpleThreadId = useRouterState({
    select: (state) => (state.location.search as { thread?: string }).thread,
  });
  const { t } = useTranslation();
  const threadId = useTimelineStore((s) => s.threadId);
  const threadMode = useTimelineStore((s) => s.threadMode);
  const turnStartPending = useTimelineStore((s) => s.turnStartPending);
  const activeTurnId = useTimelineStore((s) => s.activeTurnId);
  const approvals = useTimelineStore((s) => s.approvals);
  const threadStatus = useTimelineStore((s) => s.threadStatus);
  const threadsById = useTimelineStore((s) => s.threadsById);
  const subscribedThreadIds = useTimelineStore((s) => s.subscribedThreadIds);
  const setActiveThread = useTimelineStore((s) => s.setActiveThread);
  const clearThread = useTimelineStore((s) => s.clearThread);
  const setThreadTitle = useTimelineStore((s) => s.setThreadTitle);
  const addSystemError = useTimelineStore((s) => s.addSystemError);
  const queryClient = useQueryClient();

  // ── Layout store (sidebar view + collapsed groups) ──────────────────
  const sidebarView = useLayoutStore((s) => s.sidebarView);
  const setSidebarView = useLayoutStore((s) => s.setSidebarView);
  const collapsedGroupKeys = useLayoutStore((s) => s.collapsedGroupKeys);
  const toggleCollapsedGroup = useLayoutStore((s) => s.toggleCollapsedGroup);
  // Derive Set<string> for child components that expect it
  const collapsedGroups = useMemo(() => new Set(collapsedGroupKeys), [collapsedGroupKeys]);

  // ── Local UI state (ephemeral) ─────────────────────────────────────
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([]);
  const [renameThread, setRenameThread] = useState<ThreadDto | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [dirPickerOpen, setDirPickerOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [graphTargetId, setGraphTargetId] = useState<string | null>(null);
  const [renameSimpleThread, setRenameSimpleThread] = useState<SimpleChatThread | null>(null);
  const [renameSimpleValue, setRenameSimpleValue] = useState('');

  // ── Queries ─────────────────────────────────────────────────────────
  // The sidebar reads one server-side projection. It used to join a paginated
  // thread list with the branch topology on the client, fold branches into
  // their root row and lift the newest member's timestamp for sorting — a
  // derivation over two independently refetched queries. Whichever landed
  // first was rendered, so a single delete visibly reshuffled the list twice.
  // Debouncing could not fix that: it coalesces repeats of one query, not the
  // gap between two.
  //
  // The two home-view queries are gated on the home view actually being shown.
  // Overview and detail replace one another in the tree below, but these ran
  // unconditionally, so sitting in a workspace kept refetching two projections
  // nothing was rendering. The backend now serves warm requests from a shared
  // metadata collection, so this no longer enumerates the stored list per
  // request — but each projection still collapses whole branch trees, and a
  // refetch nothing renders is still work spent on a view that is not on screen.
  //
  // Gating is safe for painting — TanStack Query keeps the last data for a
  // disabled query, so returning to the home view paints immediately and
  // refetches in the background. That retained data must not be read as though
  // it were current: see `displayedRows` below.
  const isHomeView = sidebarView.type === 'overview';
  const overviewThreadsQuery = useQuery({
    ...threadsListOverviewOptions({
      query: { archived: false, limit: 100, sortKey: 'updated_at' },
    }),
    enabled: isHomeView,
  });
  const overviewArchivedQuery = useQuery({
    ...threadsListOverviewOptions({
      query: { archived: true, limit: 5, sortKey: 'updated_at' },
    }),
    enabled: isHomeView,
  });
  const detailQuery = useQuery({
    ...threadsListOverviewOptions({
      query:
        sidebarView.type === 'workspaceDetail'
          ? { archived: false, cwd: sidebarView.cwd, cursor: cursor ?? undefined, limit: 20, sortKey: 'updated_at' }
          : { archived: true, cursor: cursor ?? undefined, limit: 20, sortKey: 'updated_at' },
    }),
    enabled: sidebarView.type !== 'overview',
  });
  const simpleChatThreadsQuery = useQuery({
    queryKey: ['simple-chat-threads'],
    queryFn: () => simpleChatApi<{ threads: SimpleChatThread[] }>('/threads'),
  });

  // ── Deletion ────────────────────────────────────────────────────────
  const adoptionStatus = useBranchAdoptionStatus();
  const deleteBlockedReason = adoptionBlockReason(adoptionStatus.data, t);
  const deletePreview = useDeletePreview(deleteTargetId);
  // No survivor to offer: this entry point deletes a whole conversation tree,
  // so there is nothing left of it to land on.
  const deleteThread = useDeleteThread({
    onFinished: () => setDeleteTargetId(null),
  });

  // Rows arrive already collapsed and sorted; the client only indexes them so
  // a row can be looked up by the thread it displays.
  const rowsByView = useMemo(
    () => ({
      active: overviewThreadsQuery.data?.data ?? [],
      archived: overviewArchivedQuery.data?.data ?? [],
      detail: detailQuery.data?.data ?? [],
    }),
    [overviewThreadsQuery.data, overviewArchivedQuery.data, detailQuery.data],
  );
  // Which views may contribute, and why, is enforced in `selectSidebarRows`.
  const { rowByThreadId, displayThreadIdByMember, visibleThreads } = useMemo(
    () => selectSidebarRows(rowsByView, isHomeView),
    [rowsByView, isHomeView],
  );

  const activeThreads = useMemo(
    () => rowsByView.active.map((row) => row.thread),
    [rowsByView.active],
  );
  const archivedThreads = useMemo(
    () => rowsByView.archived.map((row) => row.thread),
    [rowsByView.archived],
  );
  const workspaceGroups = useMemo(() => groupByWorkspace(activeThreads), [activeThreads]);
  const detailThreads = useMemo(
    () => rowsByView.detail.map((row) => row.thread),
    [rowsByView.detail],
  );

  const highlightedThreadId = threadId
    ? (displayThreadIdByMember.get(threadId) ?? threadId)
    : null;

  // Shares the timer the socket dispatcher uses, so a mutation and the
  // notification it provokes produce one refetch rather than two.
  const invalidateThreads = () => invalidateThreadListSoon(queryClient);

  // ── Thread open helpers ─────────────────────────────────────────────
  //
  // The sidebar navigates and nothing more. Opening — resume, hydration, the
  // loading decision — belongs to the route, which is the only place that can
  // know a conversation is already on screen. Doing it here as well meant one
  // click resumed the same thread twice, and resume is not a read: it claims
  // writer ownership.

  /**
   * True when the thread is already open *and on screen*.
   *
   * Selecting a thread leaves it selected in the store while the user moves to
   * settings, diagnostics or integrations, so store state alone cannot answer
   * "is a click a no-op" — the chat view has to actually be the one showing.
   */
  const isThreadOnScreen = (threadIdToCheck: string, mode: 'live' | 'readOnly') =>
    threadIdToCheck === threadId && threadMode === mode && activeView === 'chat';

  /**
   * Resolves which member of a collapsed row to actually open.
   *
   * A row stands for a whole branch tree, so opening it at the tree root would
   * discard the branch the user was last reading and force them to step back
   * through the version switcher one at a time. The server resolves the pointer
   * — it is shared across devices — and falls back to the displayed thread.
   */
  const openTargetFor = (thread: ThreadDto): string =>
    rowByThreadId.get(thread.id)?.openThreadId ?? thread.id;

  /** Navigate to archived thread — ThreadView handles loading (resume → fail → read). */
  const openArchivedThread = (thread: ThreadDto) => {
    const target = openTargetFor(thread);
    if (isThreadOnScreen(target, 'readOnly')) return;
    void navigate({ to: '/t/$threadId', params: { threadId: target } });
  };

  const openLiveThread = (thread: ThreadDto) => {
    const target = openTargetFor(thread);
    if (isThreadOnScreen(target, 'live')) return;
    void navigate({ to: '/t/$threadId', params: { threadId: target } });
  };

  /**
   * Leaves an archived conversation, accounting for whole-tree archival.
   *
   * Archiving a root archives its hidden branches too, so the check cannot be
   * "am I on the row that was archived" — the user may be sitting on a branch
   * that has no row of its own.
   */
  const switchAfterArchive = (archivedId: string, memberThreadIds: readonly string[]) => {
    const current = useTimelineStore.getState();
    const archivedTree = new Set(memberThreadIds);
    if (
      !current.threadId ||
      !archivedTree.has(current.threadId) ||
      current.threadMode !== 'live'
    ) {
      return;
    }
    const idx = visibleThreads.findIndex((th) => th.id === archivedId);
    const next =
      visibleThreads.slice(idx + 1).find((th) => !archivedTree.has(th.id)) ??
      visibleThreads.slice(0, idx).find((th) => !archivedTree.has(th.id));
    if (next) openLiveThread(next);
    else { clearThread(); void navigate({ to: '/' }); }
  };

  // ── Mutations ───────────────────────────────────────────────────────
  const createThread = useMutation({
    ...threadsStartThreadMutation(),
    onSuccess: (res) => {
      setActiveThread(res.thread.id, res.cwd, threadLabel(res.thread));
      invalidateThreads();
      void navigate({ to: '/t/$threadId', params: { threadId: res.thread.id } });
    },
    onError: (err) => addSystemError(getApiErrorMessage(err)),
  });

  const archiveThread = useMutation({
    ...threadsArchiveThreadMutation(),
    // Carry the confirmation's membership into this mutation's context. A
    // refetch can remove the row while the dialog or the HTTP request is open.
    onMutate: (vars) => {
      const pending =
        confirmAction?.type === 'archive' ? confirmAction.memberThreadIds : null;
      const treeIds = [...(pending ?? [vars.path.threadId])];
      setConfirmAction(null);
      return { treeIds };
    },
    onSuccess: (_res, vars, context) => {
      const treeIds = context!.treeIds;
      for (const id of treeIds) useTimelineStore.getState().unsubscribeThread(id);
      switchAfterArchive(vars.path.threadId, treeIds);
    },
    // Whole-tree archival can fail partway through, leaving some members
    // archived; the list is stale either way, so refresh on settled.
    onSettled: () => invalidateThreads(),
    onError: (err) => addSystemError(getApiErrorMessage(err)),
  });

  const unarchiveThread = useMutation({
    ...threadsUnarchiveThreadMutation(),
    onSuccess: (res) => {
      if (threadId === res.thread.id && threadMode === 'readOnly') openLiveThread(res.thread);
    },
    onSettled: () => invalidateThreads(),
    onError: (err) => addSystemError(getApiErrorMessage(err)),
  });

  const compactThread = useMutation({
    ...threadsCompactThreadMutation(),
    onSuccess: () => invalidateThreads(),
  });

  const forkThread = useMutation({
    ...threadsForkThreadMutation(),
    onSuccess: (res, vars) => {
      const tid = res.thread.id;
      invalidateThreads();
      invalidateBranchTreesSoon(queryClient);
      invalidateBranchTreeMembersSoon(queryClient, [
        vars.path.threadId,
        tid,
      ]);
      // The fork response is metadata-only. Navigation hands hydration to the
      // canonical opener, which pages history and reads inherited auxiliary
      // data only after the backend has committed the provenance edge.
      void navigate({ to: '/t/$threadId', params: { threadId: tid } });
    },
  });

  // Forking asks about the source goal first, and only when one is live.
  const fork = useForkWithGoal({
    onFork: (threadId, carryGoal) =>
      forkThread.mutate({ path: { threadId }, body: { carryGoal } }),
  });

  const updateThreadName = useMutation({
    ...threadsSetThreadNameMutation(),
    onSuccess: (_res, vars) => {
      if (vars.path.threadId === threadId) setThreadTitle(vars.body.name.trim());
      setRenameThread(null);
      setRenameValue('');
      invalidateThreads();
    },
  });
  const createSimpleChatThread = useMutation({
    mutationFn: () =>
      simpleChatApi<{ thread: SimpleChatThread }>('/threads', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['simple-chat-threads'] });
      void navigate({ to: '/simple-chat', search: { thread: result.thread.id } });
    },
    onError: (err) => addSystemError(getApiErrorMessage(err)),
  });
  const renameSimpleChat = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      simpleChatApi(`/threads/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      }),
    onSuccess: () => {
      setRenameSimpleThread(null);
      setRenameSimpleValue('');
      void queryClient.invalidateQueries({ queryKey: ['simple-chat-threads'] });
    },
    onError: (err) => addSystemError(getApiErrorMessage(err)),
  });

  // ── View navigation helpers ─────────────────────────────────────────

  const resetDetailPagination = () => { setCursor(null); setCursorStack([]); };

  const openWorkspaceDetail = (cwd: string) => { resetDetailPagination(); setSidebarView({ type: 'workspaceDetail', cwd }); };
  const openArchivedDetail = () => { resetDetailPagination(); setSidebarView({ type: 'archivedDetail' }); };

  const goNext = () => {
    if (!detailQuery.data?.nextCursor) return;
    setCursorStack((s) => [...s, cursor]);
    setCursor(detailQuery.data.nextCursor);
  };
  const goPrevious = () => {
    setCursorStack((s) => { const ns = s.slice(0, -1); setCursor(s.at(-1) ?? null); return ns; });
  };

  // ── Rename / Confirm ────────────────────────────────────────────────
  const startRename = (thread: ThreadDto) => { setRenameThread(thread); setRenameValue(threadLabel(thread)); };
  const saveRename = () => {
    if (!renameThread) return;
    const name = renameValue.trim();
    if (!name) return;
    updateThreadName.mutate({ path: { threadId: renameThread.id }, body: { name } });
  };
  const confirmCurrentAction = () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'archive') {
      archiveThread.mutate({ path: { threadId: confirmAction.thread.id } });
      // onMutate transfers the pending action before dismissing its dialog.
      return;
    }
    if (confirmAction.type === 'compact') compactThread.mutate({ path: { threadId: confirmAction.thread.id } });
    setConfirmAction(null);
  };

  // ── Shared thread-row renderer (passed to overview/detail) ──────────
  const renderThreadRow = (thread: ThreadDto, archived: boolean) => {
    const row = rowByThreadId.get(thread.id);
    const readRuntime = (id: string) =>
      id === threadId ? { turnStartPending, activeTurnId, approvals, threadStatus } : threadsById[id];

    // Row flags come from the server, which already lifted them off hidden
    // branch members. Local socket state is layered on top because it is
    // instantaneous where the projection is only as fresh as its last refetch.
    // This is safe in a way the old client-side join was not: these flags feed
    // badges, never ordering, so a difference between the two sources cannot
    // reshuffle the list.
    const treeRuntimes = (row?.memberThreadIds ?? [thread.id])
      .map(readRuntime)
      .filter((runtime) => runtime !== undefined);

    // Cached lifecycle stops advancing when the transcript leaves its room.
    // It cannot override the backend's current status for a background member.
    const observedRuntimes = (row?.memberThreadIds ?? [thread.id])
      .filter((id) => subscribedThreadIds.has(id)).map(readRuntime)
      .filter((runtime) => runtime !== undefined);
    const isRunning = observedRuntimes.some((runtime) => (runtime.turnStartPending || runtime.activeTurnId));
    const activeFlags = observedRuntimes.flatMap((runtime) =>
      runtime.threadStatus?.type === 'active' ? runtime.threadStatus.activeFlags : [],
    );
    const localPendingCount = treeRuntimes.reduce(
      (total, runtime) =>
        total +
        Object.values(runtime.approvals ?? {}).filter((a) => a.status === 'pending').length,
      0,
    );
    const pendingApprovalCount = Math.max(
      localPendingCount,
      row?.pendingApprovalCount ?? 0,
    );
    const waitingOnApproval =
      Boolean(row?.waitingOnApproval) ||
      activeFlags.includes('waitingOnApproval') ||
      pendingApprovalCount > 0;
    const waitingOnUserInput =
      Boolean(row?.waitingOnUserInput) || activeFlags.includes('waitingOnUserInput');
    // "Generating" = thread active but not blocked on any user-facing request.
    const generating =
      (Boolean(row?.running) ||
        observedRuntimes.some((runtime) => runtime.threadStatus?.type === 'active')) &&
      !waitingOnApproval &&
      !waitingOnUserInput;

    return (
      <ThreadRow
        key={thread.id}
        thread={thread}
        archived={archived}
        isActive={thread.id === highlightedThreadId && activeView === 'chat'}
        destructiveDisabled={isRunning || Boolean(row?.running)}
        actionPending={forkThread.isPending || unarchiveThread.isPending}
        running={generating || isRunning}
        pendingApproval={waitingOnApproval}
        pendingApprovalCount={pendingApprovalCount}
        waitingOnUserInput={waitingOnUserInput}
        hasBranchDescendants={Boolean(row?.hasBranchDescendants)}
        onOpen={() => { if (archived) void openArchivedThread(thread); else openLiveThread(thread); }}
        onRename={() => startRename(thread)}
        onArchive={() => setConfirmAction({ type: 'archive', thread, memberThreadIds: [...(row?.memberThreadIds ?? [thread.id])] })}
        onUnarchive={() => unarchiveThread.mutate({ path: { threadId: thread.id } })}
        onCompact={() => setConfirmAction({ type: 'compact', thread })}
        onFork={() => void fork.requestFork(thread.id)}
        deleteBlockedReason={deleteBlockedReason}
        onDelete={() => setDeleteTargetId(thread.id)}
        onShowBranchGraph={() => setGraphTargetId(thread.id)}
      />
    );
  };

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col bg-card/80">
      {/* Global actions */}
      <div className="space-y-0.5 px-2 py-2">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => createSimpleChatThread.mutate()}
            className={cn(
              'flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
              activeView === 'simpleChat'
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            <MessageCircle className="h-4 w-4 shrink-0" />
            Chat simple
          </button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            title="Nouvelle discussion simple"
            aria-label="Nouvelle discussion simple"
            disabled={createSimpleChatThread.isPending}
            onClick={() => createSimpleChatThread.mutate()}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="mb-1 ml-3 space-y-0.5 border-l pl-1.5">
          {simpleChatThreadsQuery.data?.threads.map((thread) => (
            <div key={thread.id} className="group flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => void navigate({ to: '/simple-chat', search: { thread: thread.id } })}
                className={cn(
                  'min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/50 hover:text-foreground',
                  activeView === 'simpleChat' && activeSimpleThreadId === thread.id
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground',
                )}
                title={thread.title}
              >
                {thread.title}
              </button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                title="Renommer"
                aria-label={`Renommer ${thread.title}`}
                onClick={() => {
                  setRenameSimpleThread(thread);
                  setRenameSimpleValue(thread.title);
                }}
              >
                <Pencil className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void navigate({ to: '/files' })}
          className={cn(
            'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
            activeView === 'files'
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <FolderOpen className="h-4 w-4 shrink-0" />
          {t('Files')}
        </button>
        <button
          type="button"
          onClick={() => void navigate({ to: '/terminal' })}
          className={cn(
            'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
            activeView === 'terminal'
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <Terminal className="h-4 w-4 shrink-0" />
          {t('Terminal')}
        </button>
        <button
          type="button"
          onClick={() => void navigate({ to: '/integrations', search: { tab: 'plugins' } })}
          className={cn(
            'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
            activeView === 'integrations'
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <Puzzle className="h-4 w-4 shrink-0" />
          {t('Integrations')}
        </button>
        <button
          type="button"
          onClick={() => void navigate({ to: '/settings' })}
          className={cn(
            'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
            activeView === 'settings'
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          {t('Settings')}
        </button>
      </div>

      <Separator />

      {/* Thread list header */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">{t('Threads')}</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          aria-label={t('New workspace thread')}
          title={t('New workspace thread')}
          onClick={() => setDirPickerOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-2 [&_[data-slot=scroll-area-viewport]>div]:block!">
        {sidebarView.type === 'overview' ? (
          <WorkspaceOverview
            archivedThreads={archivedThreads}
            workspaceGroups={workspaceGroups}
            collapsedGroups={collapsedGroups}
            isLoading={overviewThreadsQuery.isLoading || overviewArchivedQuery.isLoading}
            onToggleCollapse={toggleCollapsedGroup}
            onOpenArchivedDetail={openArchivedDetail}
            onOpenWorkspaceDetail={openWorkspaceDetail}
            onCreateInWorkspace={(cwd) => createThread.mutate({ body: { cwd } })}
            renderThreadRow={renderThreadRow}
          />
        ) : (
          <WorkspaceDetail
            sidebarView={sidebarView}
            threads={detailThreads}
            isLoading={detailQuery.isLoading}
            hasPrevious={cursorStack.length > 0}
            hasNext={!!detailQuery.data?.nextCursor}
            onBack={() => setSidebarView({ type: 'overview' })}
            onPrevious={goPrevious}
            onNext={goNext}
            renderThreadRow={renderThreadRow}
          />
        )}
      </ScrollArea>

      {/* The collapse toggle deliberately lives in the shell header, not here:
          a control pinned to the sidebar's own bottom edge disappears with the
          sidebar, which forced expanding to live somewhere else entirely. */}

      <RenameDialog
        open={renameThread !== null}
        pending={updateThreadName.isPending}
        value={renameValue}
        onChange={setRenameValue}
        onSave={saveRename}
        onClose={() => setRenameThread(null)}
      />
      <RenameDialog
        open={renameSimpleThread !== null}
        pending={renameSimpleChat.isPending}
        value={renameSimpleValue}
        onChange={setRenameSimpleValue}
        onSave={() => {
          if (renameSimpleThread && renameSimpleValue.trim()) {
            renameSimpleChat.mutate({
              id: renameSimpleThread.id,
              title: renameSimpleValue.trim(),
            });
          }
        }}
        onClose={() => setRenameSimpleThread(null)}
      />
      <ConfirmDialog
        action={confirmAction}
        pending={archiveThread.isPending || compactThread.isPending}
        onConfirm={confirmCurrentAction}
        onClose={() => setConfirmAction(null)}
      />
      <DirectoryPickerDialog
        open={dirPickerOpen}
        onClose={() => setDirPickerOpen(false)}
        onSelect={(cwd) => createThread.mutate({ body: { cwd } })}
      />
      <ForkGoalDialog
        key={fork.prompt?.threadId ?? 'idle'}
        prompt={fork.prompt}
        pending={forkThread.isPending}
        onConfirm={fork.confirm}
        onCancel={fork.cancel}
      />
      <DeleteConversationDialog
        open={deleteTargetId !== null}
        preview={deletePreview.data ?? null}
        loading={deletePreview.isLoading}
        errorMessage={
          deletePreview.error ? getApiErrorMessage(deletePreview.error) : null
        }
        pending={deleteThread.isPending}
        currentThreadId={threadId}
        onConfirm={(preview) =>
          deleteThread.mutate({
            path: { threadId: preview.targetThreadId },
            body: buildDeleteRequestBody(preview),
          })
        }
        onClose={() => setDeleteTargetId(null)}
      />
      <BranchGraphDialog
        threadId={graphTargetId}
        onClose={() => setGraphTargetId(null)}
      />
    </div>
  );
}
