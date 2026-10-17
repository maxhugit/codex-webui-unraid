import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Gantt, WillowDark } from '@svar-ui/react-gantt';
import '@svar-ui/react-gantt/all.css';
import {
  Bot,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  FolderOpen,
  GripVertical,
  ListFilter,
  ListTodo,
  Loader2,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DirectorySelectionTree } from '@/components/files/directory-selection-tree';
import { threadsStartThread, threadsStartTurn } from '@/generated/api/sdk.gen';
import {
  projectsApi,
  type ProjectTaskBoard,
  type ProjectTaskStatusSummary,
  type ProjectTaskSummary,
} from '@/lib/projects-api';

type Draft = {
  title: string;
  description: string;
  priority: ProjectTaskSummary['priority'];
  startAt: string;
  dueAt: string;
  labels: string;
  statusId: string;
  workspacePath: string;
  executionMode: 'manual' | 'agent';
  estimateHours: string;
  validationCriteria: string;
  linkedFilePath: string;
  parentTaskId: string;
  subtaskStatus: ProjectTaskSummary['subtaskStatus'];
  dependencyIds: string[];
};
type Suggestion = {
  title: string;
  description: string;
  priority: string;
  estimateHours: number;
  validationCriteria: string;
  parentTitle: string;
  dependsOnTitles: string[];
};
const emptyDraft: Draft = {
  title: '',
  description: '',
  priority: 'normal',
  startAt: '',
  dueAt: '',
  labels: '',
  statusId: '',
  workspacePath: '',
  executionMode: 'manual',
  estimateHours: '',
  validationCriteria: '',
  linkedFilePath: '',
  parentTaskId: '',
  subtaskStatus: 'todo',
  dependencyIds: [],
};
const subtaskLabels: Record<ProjectTaskSummary['subtaskStatus'], string> = {
  todo: 'À faire',
  started: 'Commencée',
  review: 'À valider',
  done: 'Terminée',
  cancelled: 'Annulée',
};
const priorities = {
  low: 'Basse',
  normal: 'Normale',
  high: 'Haute',
  urgent: 'Urgente',
} as const;
const priorityStyle = {
  low: 'bg-slate-500/15 text-slate-400',
  normal: 'bg-blue-500/15 text-blue-400',
  high: 'bg-orange-500/15 text-orange-400',
  urgent: 'bg-red-500/15 text-red-400',
} as const;
const agentLabels: Record<string, string> = {
  ready: 'Agent prêt',
  running: 'Agent en cours',
  waiting: 'Autorisation requise',
  error: 'Agent en erreur',
  review: 'Résultat à valider',
  validated: 'Validée',
};
const dateValue = (value: number | null) =>
  value ? new Date(value).toISOString().slice(0, 10) : '';

export function ProjectTaskManager({
  projectId,
  resourceId,
  initialTaskId,
}: {
  projectId: string;
  resourceId: string;
  initialTaskId?: string;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const key = ['project-resource', projectId, resourceId];
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      projectsApi<ProjectTaskBoard>(`/${projectId}/resources/${resourceId}`),
    refetchInterval: 5000,
  });
  const refresh = () => client.invalidateQueries({ queryKey: key });
  const request = useMutation({
    mutationFn: ({
      path,
      method,
      body,
    }: {
      path: string;
      method: string;
      body?: unknown;
    }) =>
      projectsApi(path, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    onSuccess: refresh,
  });
  const [view, setView] = useState<'board' | 'planning'>('board');
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState('all');
  const [dragged, setDragged] = useState<string | null>(null);
  const [taskOpen, setTaskOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectTaskSummary | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderSelection, setFolderSelection] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [editingStatus, setEditingStatus] =
    useState<ProjectTaskStatusSummary | null>(null);
  const [statusName, setStatusName] = useState('');
  const [statusColor, setStatusColor] = useState('blue');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<Suggestion[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [agentBusy, setAgentBusy] = useState(false);
  const [taskTab, setTaskTab] = useState<'details' | 'subtasks'>('details');
  const openedInitialTask = useRef<string | null>(null);
  useEffect(() => {
    if (
      !initialTaskId ||
      !query.data ||
      openedInitialTask.current === initialTaskId
    )
      return;
    const task = query.data.tasks.find((item) => item.id === initialTaskId);
    if (!task) return;
    openedInitialTask.current = initialTaskId;
    const dependencyIds = query.data.dependencies
      .filter((dependency) => dependency.taskId === task.id)
      .map((dependency) => dependency.dependsOnTaskId);
    queueMicrotask(() => {
      setEditing(task);
      setDraft({
        title: task.title,
        description: task.description,
        priority: task.priority,
        startAt: dateValue(task.startAt),
        dueAt: dateValue(task.dueAt),
        labels: task.labels.join(', '),
        statusId: task.statusId,
        workspacePath: task.workspacePath ?? query.data!.project.workspacePath,
        executionMode: task.executionMode,
        estimateHours: task.estimateMinutes
          ? String(task.estimateMinutes / 60)
          : '',
        validationCriteria: task.validationCriteria,
        linkedFilePath: task.linkedFilePath ?? '',
        parentTaskId: task.parentTaskId ?? '',
        subtaskStatus: task.subtaskStatus,
        dependencyIds,
      });
      setTaskTab('details');
      setTaskOpen(true);
    });
  }, [initialTaskId, query.data]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (query.data?.tasks ?? []).filter(
      (task) =>
        !task.parentTaskId &&
        (priority === 'all' || task.priority === priority) &&
        (!needle ||
          `${task.title} ${task.description} ${task.labels.join(' ')}`
            .toLowerCase()
            .includes(needle)),
    );
  }, [query.data?.tasks, search, priority]);
  if (query.isLoading)
    return <div className="p-6 text-sm text-muted-foreground">Chargement…</div>;
  if (!query.data)
    return (
      <div className="p-6 text-sm text-destructive">
        Impossible de charger le gestionnaire de tâches.
      </div>
    );
  const board = query.data;
  const unassigned =
    board.statuses.find((s) => s.kind === 'unassigned') ?? board.statuses[0];
  const statusByKind = (kind: string) =>
    board.statuses.find((s) => s.kind === kind);
  const dependencyIdsFor = (id: string) =>
    board.dependencies
      .filter((d) => d.taskId === id)
      .map((d) => d.dependsOnTaskId);
  const childrenFor = (id: string) =>
    board.tasks.filter((t) => t.parentTaskId === id);
  const blocked = (task: ProjectTaskSummary) =>
    dependencyIdsFor(task.id).some(
      (id) =>
        statusByKind('done')?.id !==
        board.tasks.find((item) => item.id === id)?.statusId,
    );
  const openNew = (parentTaskId = '') => {
    const parent = parentTaskId
      ? board.tasks.find((task) => task.id === parentTaskId)
      : null;
    setEditing(null);
    setDraft({
      ...emptyDraft,
      statusId: unassigned?.id ?? '',
      workspacePath: parent?.workspacePath ?? board.project.workspacePath,
      parentTaskId,
      subtaskStatus: 'todo',
    });
    setTaskTab('details');
    setTaskOpen(true);
  };
  const openEdit = (task: ProjectTaskSummary) => {
    setEditing(task);
    setDraft({
      title: task.title,
      description: task.description,
      priority: task.priority,
      startAt: dateValue(task.startAt),
      dueAt: dateValue(task.dueAt),
      labels: task.labels.join(', '),
      statusId: task.statusId,
      workspacePath: task.workspacePath ?? board.project.workspacePath,
      executionMode: task.executionMode,
      estimateHours: task.estimateMinutes
        ? String(task.estimateMinutes / 60)
        : '',
      validationCriteria: task.validationCriteria,
      linkedFilePath: task.linkedFilePath ?? '',
      parentTaskId: task.parentTaskId ?? '',
      subtaskStatus: task.subtaskStatus,
      dependencyIds: dependencyIdsFor(task.id),
    });
    setTaskTab(task.parentTaskId ? 'details' : 'details');
    setTaskOpen(true);
  };
  const payload = () => ({
    title: draft.title.trim(),
    description: draft.description.trim(),
    priority: draft.priority,
    startAt: draft.startAt
      ? new Date(`${draft.startAt}T12:00:00`).getTime()
      : null,
    dueAt: draft.dueAt ? new Date(`${draft.dueAt}T12:00:00`).getTime() : null,
    labels: draft.labels
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
    statusId: draft.statusId,
    workspacePath: draft.workspacePath || board.project.workspacePath,
    executionMode: draft.executionMode,
    estimateMinutes: Math.round((Number(draft.estimateHours) || 0) * 60),
    validationCriteria: draft.validationCriteria.trim(),
    linkedFilePath: draft.linkedFilePath.trim() || null,
    parentTaskId: draft.parentTaskId || null,
    subtaskStatus: draft.subtaskStatus,
    dependencyIds: draft.parentTaskId ? [] : draft.dependencyIds,
  });
  const saveTask = async () => {
    if (!draft.title.trim()) return;
    await request.mutateAsync({
      path: editing
        ? `/${projectId}/resources/${resourceId}/tasks/${editing.id}`
        : `/${projectId}/resources/${resourceId}/tasks`,
      method: editing ? 'PATCH' : 'POST',
      body: payload(),
    });
    setTaskOpen(false);
  };
  const removeTask = async () => {
    if (
      !editing ||
      !window.confirm(
        `Supprimer « ${editing.title} »${childrenFor(editing.id).length ? ' et dissocier ses sous-tâches' : ''} ?`,
      )
    )
      return;
    await request.mutateAsync({
      path: `/${projectId}/resources/${resourceId}/tasks/${editing.id}`,
      method: 'DELETE',
    });
    setTaskOpen(false);
  };
  const dropTask = async (statusId: string) => {
    const task = board.tasks.find((t) => t.id === dragged);
    if (!task || task.parentTaskId || task.statusId === statusId) return;
    const target = board.statuses.find((status) => status.id === statusId);
    if (
      target?.kind === 'done' &&
      childrenFor(task.id).some(
        (child) => !['done', 'cancelled'].includes(child.subtaskStatus),
      )
    ) {
      window.alert(
        'Toutes les sous-tâches doivent être terminées ou annulées.',
      );
      setDragged(null);
      return;
    }
    await request.mutateAsync({
      path: `/${projectId}/resources/${resourceId}/tasks/${task.id}`,
      method: 'PATCH',
      body: {
        statusId,
        position: board.tasks.filter((t) => t.statusId === statusId).length,
      },
    });
    setDragged(null);
  };
  const saveStatus = async () => {
    if (!statusName.trim()) return;
    await request.mutateAsync({
      path: editingStatus
        ? `/${projectId}/resources/${resourceId}/statuses/${editingStatus.id}`
        : `/${projectId}/resources/${resourceId}/statuses`,
      method: editingStatus ? 'PATCH' : 'POST',
      body: { name: statusName.trim(), color: statusColor },
    });
    setStatusOpen(false);
  };
  const removeStatus = async (status: ProjectTaskStatusSummary) => {
    if (
      status.system ||
      !window.confirm(
        `Supprimer « ${status.name} » ? Les tâches seront replacées dans Actions non assignées.`,
      )
    )
      return;
    await request.mutateAsync({
      path: `/${projectId}/resources/${resourceId}/statuses/${status.id}`,
      method: 'DELETE',
    });
  };
  const generatePlan = async () => {
    setAiLoading(true);
    setAiError('');
    try {
      const result = await projectsApi<{ tasks: Suggestion[] }>(
        `/${projectId}/resources/${resourceId}/ai-plan`,
        { method: 'POST', body: JSON.stringify({ prompt: aiPrompt }) },
      );
      setAiSuggestions(result.tasks);
      if (!result.tasks.length) setAiError('L’IA n’a proposé aucune tâche.');
    } catch (error) {
      setAiError(
        error instanceof Error ? error.message : 'La planification a échoué.',
      );
    } finally {
      setAiLoading(false);
    }
  };
  const addSuggestions = async () => {
    setAiLoading(true);
    try {
      const created = new Map<string, string>();
      const plannedDates = new Map<
        string,
        { startAt: number; dueAt: number }
      >();
      const day = 86_400_000;
      const today = new Date();
      today.setHours(12, 0, 0, 0);
      const schedule = (
        item: Suggestion,
        visiting = new Set<string>(),
      ): { startAt: number; dueAt: number } => {
        const known = plannedDates.get(item.title);
        if (known) return known;
        if (visiting.has(item.title))
          return { startAt: today.getTime(), dueAt: today.getTime() };
        visiting.add(item.title);
        const predecessors = item.dependsOnTitles
          .map((title) =>
            aiSuggestions.find((candidate) => candidate.title === title),
          )
          .filter((candidate): candidate is Suggestion => Boolean(candidate))
          .map((candidate) => schedule(candidate, visiting));
        const startAt = predecessors.length
          ? Math.max(...predecessors.map((date) => date.dueAt + day))
          : today.getTime();
        const durationDays = Math.max(
          1,
          Math.ceil((item.estimateHours || 8) / 8),
        );
        const result = {
          startAt,
          dueAt: startAt + (durationDays - 1) * day,
        };
        plannedDates.set(item.title, result);
        visiting.delete(item.title);
        return result;
      };
      for (const suggestion of aiSuggestions) {
        const dates = schedule(suggestion);
        const result = await projectsApi<{ task: ProjectTaskSummary }>(
          `/${projectId}/resources/${resourceId}/tasks`,
          {
            method: 'POST',
            body: JSON.stringify({
              ...suggestion,
              estimateMinutes: Math.round(suggestion.estimateHours * 60),
              workspacePath: board.project.workspacePath,
              ...dates,
            }),
          },
        );
        created.set(suggestion.title, result.task.id);
      }
      for (const suggestion of aiSuggestions) {
        const id = created.get(suggestion.title);
        if (!id) continue;
        const parentTaskId = created.get(suggestion.parentTitle) ?? null;
        await projectsApi(`/${projectId}/resources/${resourceId}/tasks/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            parentTaskId,
            dependencyIds: parentTaskId
              ? []
              : suggestion.dependsOnTitles
                  .map((title) => created.get(title))
                  .filter(Boolean),
          }),
        });
      }
      await refresh();
      setAiOpen(false);
      setAiSuggestions([]);
      setAiPrompt('');
    } catch (error) {
      setAiError(
        error instanceof Error ? error.message : 'Création impossible.',
      );
    } finally {
      setAiLoading(false);
    }
  };
  const runAgent = async () => {
    if (!editing || blocked(editing)) return;
    setAgentBusy(true);
    try {
      await projectsApi(
        `/${projectId}/resources/${resourceId}/tasks/${editing.id}`,
        { method: 'PATCH', body: JSON.stringify(payload()) },
      );
      const cwd = draft.workspacePath || board.project.workspacePath;
      const started = await threadsStartThread({
        body: { cwd },
        throwOnError: true,
      });
      const thread = started.data?.thread;
      if (!thread) throw new Error('Impossible de créer l’agent');
      await projectsApi(`/${projectId}/agents/${thread.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          workspacePath: cwd,
          alreadyAtWorkspace: true,
        }),
      });
      const inProgress = statusByKind('in_progress');
      await projectsApi(
        `/${projectId}/resources/${resourceId}/tasks/${editing.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            linkedThreadId: thread.id,
            executionMode: 'agent',
            agentState: 'running',
            ...(editing.parentTaskId
              ? { subtaskStatus: 'started' }
              : inProgress
                ? { statusId: inProgress.id }
                : {}),
          }),
        },
      );
      const instructions = `Exécute cette tâche de projet.\n\nTitre : ${draft.title}\nDescription : ${draft.description || 'Non précisée'}\nCharge estimée : ${draft.estimateHours || 'non estimée'} heure(s)\nConditions de validation : ${draft.validationCriteria || 'Non précisées'}\n\nTravaille uniquement dans ${cwd}. Lorsque le résultat est prêt, résume ce qui a été réalisé et les vérifications effectuées. Ne déclare pas toi-même la tâche définitivement validée.`;
      await threadsStartTurn({
        path: { threadId: thread.id },
        body: {
          input: [{ type: 'text', text: instructions, text_elements: [] }],
        },
        throwOnError: true,
      });
      await refresh();
      setTaskOpen(false);
      void navigate({ to: '/t/$threadId', params: { threadId: thread.id } });
    } catch (error) {
      await projectsApi(
        `/${projectId}/resources/${resourceId}/tasks/${editing.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            executionMode: 'agent',
            agentState: 'error',
          }),
        },
      ).catch(() => undefined);
      window.alert(
        error instanceof Error
          ? error.message
          : 'Le lancement de l’agent a échoué.',
      );
    } finally {
      setAgentBusy(false);
    }
  };
  const validateTask = async () => {
    if (!editing) return;
    const done = statusByKind('done');
    await request.mutateAsync({
      path: `/${projectId}/resources/${resourceId}/tasks/${editing.id}`,
      method: 'PATCH',
      body: editing.parentTaskId
        ? { agentState: 'validated', subtaskStatus: 'done' }
        : { agentState: 'validated', ...(done ? { statusId: done.id } : {}) },
    });
    setTaskOpen(false);
  };
  const ganttTasks = board.tasks
    .filter((t) => !t.parentTaskId && (t.startAt || t.dueAt))
    .map((t) => {
      const fallback = t.startAt ?? t.dueAt!;
      const start = new Date(t.startAt ?? fallback);
      const end = new Date(t.dueAt ?? fallback);
      return {
        id: t.id,
        text: t.title,
        start,
        duration: Math.max(
          1,
          Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1,
        ),
        progress: statusByKind('done')?.id === t.statusId ? 100 : 0,
        parent: 0,
        type: 'task',
        open: true,
      };
    });
  const ganttLinks = board.dependencies.map((d, index) => ({
    id: index + 1,
    source: d.dependsOnTaskId,
    target: d.taskId,
    type: 'e2s',
  }));

  return (
    <main className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <ListTodo className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{board.resource.name}</h1>
            <p className="text-sm text-muted-foreground">
              {board.tasks.length} action{board.tasks.length > 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={view === 'board' ? 'default' : 'outline'}
            onClick={() => setView('board')}
          >
            Tableau
          </Button>
          <Button
            variant={view === 'planning' ? 'default' : 'outline'}
            onClick={() => setView('planning')}
          >
            <CalendarDays />
            Planning
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setAiError('');
              setAiSuggestions([]);
              setAiOpen(true);
            }}
          >
            <Sparkles />
            Planifier avec l’IA
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setEditingStatus(null);
              setStatusName('');
              setStatusColor('blue');
              setStatusOpen(true);
            }}
          >
            <Plus />
            Statut
          </Button>
          <Button onClick={() => openNew()}>
            <Plus />
            Nouvelle tâche
          </Button>
        </div>
      </header>
      {view === 'board' ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border bg-card/50 p-2">
            <ListFilter className="ml-1 h-4 w-4 text-muted-foreground" />
            <Input
              className="min-w-48 flex-1"
              placeholder="Rechercher une tâche ou une étiquette…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="h-8 rounded-lg border bg-background px-2 text-sm"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              <option value="all">Toutes les priorités</option>
              {Object.entries(priorities).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-max gap-3 pb-4">
            {board.statuses.map((status) => {
              const tasks = filtered
                .filter((t) => t.statusId === status.id)
                .sort((a, b) => a.position - b.position);
              return (
                <section
                  key={status.id}
                  className="w-[310px] shrink-0 rounded-xl border bg-card/60 p-3"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dropTask(status.id)}
                >
                  <div className="mb-3 flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                    <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
                      {status.name}
                    </h2>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                      {tasks.length}
                    </span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => {
                        setEditingStatus(status);
                        setStatusName(status.name);
                        setStatusColor(status.color);
                        setStatusOpen(true);
                      }}
                    >
                      <Pencil />
                    </Button>
                    {!status.system && (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        onClick={() => removeStatus(status)}
                      >
                        <Trash2 className="text-destructive" />
                      </Button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {tasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        subtasks={childrenFor(task.id)}
                        blocked={blocked(task)}
                        onDrag={() => setDragged(task.id)}
                        onClick={() => openEdit(task)}
                        onSubtaskClick={openEdit}
                      />
                    ))}
                    {!tasks.length && (
                      <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                        Déposez une tâche ici
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      ) : (
        <section className="h-[70vh] min-h-[480px] overflow-hidden rounded-xl border bg-card">
          <WillowDark>
            <Gantt
              tasks={ganttTasks as never}
              links={ganttLinks as never}
              zoom
              readonly
              onselecttask={(event?: { id?: string | number }) => {
                const task = board.tasks.find(
                  (item) => item.id === String(event?.id ?? ''),
                );
                if (task) openEdit(task);
              }}
            />
          </WillowDark>
          {!ganttTasks.length && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Ajoutez des dates pour afficher les tâches dans le planning.
            </div>
          )}
        </section>
      )}
      <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
        <DialogContent className="flex max-h-[92vh] flex-col overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="px-6 pt-6">
              {editing
                ? 'Modifier la tâche'
                : draft.parentTaskId
                  ? 'Nouvelle sous-tâche'
                  : 'Nouvelle tâche'}
            </DialogTitle>
          </DialogHeader>
          {editing && !editing.parentTaskId && (
            <div className="flex gap-1 border-b px-6">
              <button
                type="button"
                className={`border-b-2 px-3 py-2 text-sm ${taskTab === 'details' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
                onClick={() => setTaskTab('details')}
              >
                Détails
              </button>
              <button
                type="button"
                className={`border-b-2 px-3 py-2 text-sm ${taskTab === 'subtasks' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
                onClick={() => setTaskTab('subtasks')}
              >
                Sous-tâches ({childrenFor(editing.id).length})
              </button>
            </div>
          )}
          {taskTab === 'details' || !editing || editing.parentTaskId ? (
            <div className="grid min-h-0 gap-3 overflow-y-auto px-6 py-3">
              <Input
                autoFocus
                placeholder="Titre"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
              <Textarea
                placeholder="Description détaillée"
                value={draft.description}
                onChange={(e) =>
                  setDraft({ ...draft, description: e.target.value })
                }
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="h-8 rounded-lg border bg-background px-2 text-sm"
                  value={draft.executionMode}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      executionMode: e.target.value as Draft['executionMode'],
                    })
                  }
                >
                  <option value="manual">Tâche manuelle</option>
                  <option value="agent">Agent IA</option>
                </select>
                <Input
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="Charge estimée (heures)"
                  value={draft.estimateHours}
                  onChange={(e) =>
                    setDraft({ ...draft, estimateHours: e.target.value })
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-muted-foreground">
                  Début
                  <Input
                    type="date"
                    value={draft.startAt}
                    onChange={(e) =>
                      setDraft({ ...draft, startAt: e.target.value })
                    }
                  />
                </label>
                <label className="text-xs text-muted-foreground">
                  Fin prévue
                  <Input
                    type="date"
                    value={draft.dueAt}
                    onChange={(e) =>
                      setDraft({ ...draft, dueAt: e.target.value })
                    }
                  />
                </label>
              </div>
              <Textarea
                placeholder="Conditions de validation / recette"
                value={draft.validationCriteria}
                onChange={(e) =>
                  setDraft({ ...draft, validationCriteria: e.target.value })
                }
              />
              <button
                type="button"
                className="flex h-9 items-center gap-2 rounded-lg border px-3 text-left text-sm"
                onClick={() => {
                  setFolderSelection(
                    draft.workspacePath || board.project.workspacePath,
                  );
                  setFolderOpen(true);
                }}
              >
                <FolderOpen className="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate">
                  {draft.workspacePath || 'Choisir un dossier'}
                </span>
                <ChevronRight className="h-4 w-4" />
              </button>
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="h-8 rounded-lg border bg-background px-2 text-sm"
                  value={draft.priority}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      priority: e.target.value as Draft['priority'],
                    })
                  }
                >
                  {Object.entries(priorities).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {editing && !editing.parentTaskId && (
                  <select
                    className="h-8 rounded-lg border bg-background px-2 text-sm"
                    value={draft.statusId}
                    onChange={(e) =>
                      setDraft({ ...draft, statusId: e.target.value })
                    }
                  >
                    {board.statuses.map((s) => (
                      <option
                        key={s.id}
                        value={s.id}
                        disabled={
                          s.kind === 'done' &&
                          childrenFor(editing.id).some(
                            (child) =>
                              !['done', 'cancelled'].includes(
                                child.subtaskStatus,
                              ),
                          )
                        }
                      >
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
                {editing?.parentTaskId && (
                  <select
                    className="h-8 rounded-lg border bg-background px-2 text-sm"
                    value={draft.subtaskStatus}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        subtaskStatus: e.target
                          .value as ProjectTaskSummary['subtaskStatus'],
                      })
                    }
                  >
                    {Object.entries(subtaskLabels)
                      .filter(
                        ([value]) =>
                          value !== 'review' || draft.executionMode === 'agent',
                      )
                      .map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                  </select>
                )}
              </div>
              <Input
                placeholder="Étiquettes séparées par des virgules"
                value={draft.labels}
                onChange={(e) => setDraft({ ...draft, labels: e.target.value })}
              />
              <Input
                placeholder="Fichier lié (facultatif)"
                value={draft.linkedFilePath}
                onChange={(e) =>
                  setDraft({ ...draft, linkedFilePath: e.target.value })
                }
              />
              {!draft.parentTaskId && (
                <fieldset className="rounded-lg border p-3">
                  <legend className="px-1 text-xs text-muted-foreground">
                    Dépend de
                  </legend>
                  <div className="max-h-28 space-y-1 overflow-auto">
                    {board.tasks
                      .filter((t) => !t.parentTaskId && t.id !== editing?.id)
                      .map((task) => (
                        <label
                          key={task.id}
                          className="flex items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            checked={draft.dependencyIds.includes(task.id)}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                dependencyIds: e.target.checked
                                  ? [...draft.dependencyIds, task.id]
                                  : draft.dependencyIds.filter(
                                      (id) => id !== task.id,
                                    ),
                              })
                            }
                          />
                          {task.title}
                        </label>
                      ))}
                  </div>
                </fieldset>
              )}
              {editing && (
                <div className="flex flex-wrap gap-2">
                  {!editing.parentTaskId && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setTaskOpen(false);
                        openNew(editing.id);
                      }}
                    >
                      <Plus />
                      Sous-tâche
                    </Button>
                  )}
                  {editing.linkedThreadId && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        navigate({
                          to: '/t/$threadId',
                          params: { threadId: editing.linkedThreadId! },
                        })
                      }
                    >
                      <Bot />
                      Ouvrir l’agent
                    </Button>
                  )}
                  {editing.agentState === 'review' && (
                    <Button onClick={validateTask}>
                      <Check />
                      Valider et terminer
                    </Button>
                  )}
                </div>
              )}
              {editing && blocked(editing) && (
                <p className="text-xs text-amber-500">
                  Cette tâche est bloquée par une dépendance non terminée.
                </p>
              )}
            </div>
          ) : (
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-6 py-4">
              <Button
                variant="outline"
                className="mb-2 w-full"
                onClick={() => openNew(editing.id)}
              >
                <Plus /> Nouvelle sous-tâche
              </Button>
              {childrenFor(editing.id).map((child) => (
                <button
                  type="button"
                  key={child.id}
                  className="flex w-full items-center gap-3 rounded-lg border p-3 text-left hover:border-primary/50"
                  onClick={() => openEdit(child)}
                >
                  {child.executionMode === 'agent' ? (
                    <Bot className="h-4 w-4 shrink-0 text-primary" />
                  ) : (
                    <Check className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {child.title}
                  </span>
                  <span className="rounded bg-muted px-2 py-1 text-[10px]">
                    {subtaskLabels[child.subtaskStatus]}
                  </span>
                </button>
              ))}
              {!childrenFor(editing.id).length && (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Aucune sous-tâche.
                </p>
              )}
            </div>
          )}
          <DialogFooter className="shrink-0 border-t bg-background px-6 py-4">
            {editing && (
              <Button variant="destructive" onClick={removeTask}>
                <Trash2 />
                Supprimer
              </Button>
            )}
            {editing &&
              draft.executionMode === 'agent' &&
              editing.agentState !== 'running' &&
              editing.agentState !== 'review' && (
                <Button
                  variant="secondary"
                  disabled={agentBusy || blocked(editing)}
                  onClick={runAgent}
                >
                  {agentBusy ? <Loader2 className="animate-spin" /> : <Play />}
                  Exécuter avec un agent
                </Button>
              )}
            <Button
              onClick={saveTask}
              disabled={!draft.title.trim() || request.isPending}
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={folderOpen} onOpenChange={setFolderOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Dossier de travail</DialogTitle>
          </DialogHeader>
          <DirectorySelectionTree
            selectedPath={folderSelection}
            onSelectedPathChange={setFolderSelection}
            allowedRoots={board.workspaces.map((w) => w.path)}
            showCreateButton
            showSelectedPath
          />
          <DialogFooter>
            <Button
              disabled={!folderSelection}
              onClick={() => {
                if (folderSelection)
                  setDraft({ ...draft, workspacePath: folderSelection });
                setFolderOpen(false);
              }}
            >
              Choisir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={statusOpen} onOpenChange={setStatusOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingStatus ? 'Modifier le statut' : 'Ajouter un statut'}
            </DialogTitle>
          </DialogHeader>
          <Input
            value={statusName}
            onChange={(e) => setStatusName(e.target.value)}
            placeholder="Nom de la colonne"
          />
          <select
            className="h-8 rounded-lg border bg-background px-2"
            value={statusColor}
            onChange={(e) => setStatusColor(e.target.value)}
          >
            {['slate', 'blue', 'amber', 'red', 'green', 'purple'].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <DialogFooter>
            <Button onClick={saveStatus}>Enregistrer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Planification assistée par IA</DialogTitle>
          </DialogHeader>
          <Textarea
            rows={5}
            placeholder="Décrivez l’objectif, les contraintes et le résultat attendu…"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
          />
          {aiLoading && (
            <div className="flex items-center gap-2 rounded-lg border p-3 text-sm">
              <Loader2 className="animate-spin" />
              L’IA construit le plan. Cela peut prendre quelques secondes…
            </div>
          )}
          {aiError && (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {aiError}
            </div>
          )}
          {aiSuggestions.length > 0 && (
            <div className="max-h-72 space-y-2 overflow-auto">
              {aiSuggestions.map((s, i) => (
                <div key={`${s.title}-${i}`} className="rounded-lg border p-3">
                  <div className="font-medium">{s.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.description}
                  </div>
                  <div className="mt-1 text-xs">
                    {s.estimateHours} h ·{' '}
                    {priorities[s.priority as keyof typeof priorities] ??
                      s.priority}
                    {s.parentTitle ? ` · sous-tâche de ${s.parentTitle}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            {aiSuggestions.length ? (
              <Button disabled={aiLoading} onClick={addSuggestions}>
                Créer les {aiSuggestions.length} tâches
              </Button>
            ) : (
              <Button
                disabled={!aiPrompt.trim() || aiLoading}
                onClick={generatePlan}
              >
                {aiLoading ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Sparkles />
                )}
                Générer le plan
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function TaskCard({
  task,
  subtasks,
  blocked,
  onDrag,
  onClick,
  onSubtaskClick,
}: {
  task: ProjectTaskSummary;
  subtasks: ProjectTaskSummary[];
  blocked: boolean;
  onDrag: () => void;
  onClick: () => void;
  onSubtaskClick: (task: ProjectTaskSummary) => void;
}) {
  return (
    <div className="rounded-lg border bg-background/80 shadow-sm">
      <button
        type="button"
        draggable
        onDragStart={onDrag}
        onClick={onClick}
        className="block w-full p-3 text-left hover:bg-accent/20"
      >
        <div className="flex gap-2">
          <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-sm font-medium">
            {task.title}
          </span>
        </div>
        {task.description && (
          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
            {task.description}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] ${priorityStyle[task.priority]}`}
          >
            {priorities[task.priority]}
          </span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
            {task.executionMode === 'manual'
              ? 'Manuel'
              : (agentLabels[task.agentState] ?? 'Agent IA')}
          </span>
          {task.estimateMinutes > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock3 className="h-3 w-3" />
              {task.estimateMinutes / 60} h
            </span>
          )}
          {task.dueAt && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <CalendarDays className="h-3 w-3" />
              {new Date(task.dueAt).toLocaleDateString()}
            </span>
          )}
          {blocked && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-500">
              Dépendance bloquante
            </span>
          )}
        </div>
      </button>
      {subtasks.length > 0 && (
        <div className="border-t px-3 py-2">
          <div className="relative space-y-1 border-l border-muted-foreground/30 pl-3">
            {subtasks.map((subtask) => (
              <button
                type="button"
                key={subtask.id}
                className="relative flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs hover:bg-accent/50"
                onClick={() => onSubtaskClick(subtask)}
              >
                <span className="absolute -left-3.5 top-1/2 w-3 border-t border-muted-foreground/30" />
                {subtask.executionMode === 'agent' ? (
                  <Bot className="h-3.5 w-3.5 shrink-0 text-primary" />
                ) : (
                  <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">{subtask.title}</span>
                <span className="shrink-0 text-[9px] text-muted-foreground">
                  {subtaskLabels[subtask.subtaskStatus]}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
