import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import {
  CalendarDays,
  GripVertical,
  ListFilter,
  ListTodo,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import {
  projectsApi,
  type ProjectTaskBoard,
  type ProjectTaskStatusSummary,
  type ProjectTaskSummary,
} from '@/lib/projects-api';

type TaskDraft = {
  title: string;
  description: string;
  priority: ProjectTaskSummary['priority'];
  dueAt: string;
  labels: string;
  statusId: string;
  linkedFilePath: string;
};
const EMPTY_TASK: TaskDraft = {
  title: '',
  description: '',
  priority: 'normal',
  dueAt: '',
  labels: '',
  statusId: '',
  linkedFilePath: '',
};
const priorityLabel = {
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

export function ProjectResourceRoute() {
  const { projectId, resourceId } = useParams({ strict: false }) as {
    projectId: string;
    resourceId: string;
  };
  const { t } = useTranslation();
  const client = useQueryClient();
  const key = ['project-resource', projectId, resourceId];
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      projectsApi<ProjectTaskBoard>(`/${projectId}/resources/${resourceId}`),
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
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState('all');
  const [taskOpen, setTaskOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ProjectTaskSummary | null>(
    null,
  );
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(EMPTY_TASK);
  const [statusOpen, setStatusOpen] = useState(false);
  const [editingStatus, setEditingStatus] =
    useState<ProjectTaskStatusSummary | null>(null);
  const [statusName, setStatusName] = useState('');
  const [statusColor, setStatusColor] = useState('blue');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<
    Array<{ title: string; description: string; priority: string }>
  >([]);
  const [draggedTask, setDraggedTask] = useState<string | null>(null);
  const filteredTasks = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return (query.data?.tasks ?? []).filter(
      (task) =>
        (priority === 'all' || task.priority === priority) &&
        (!needle ||
          `${task.title} ${task.description} ${task.labels.join(' ')}`
            .toLocaleLowerCase()
            .includes(needle)),
    );
  }, [query.data?.tasks, search, priority]);

  if (query.isLoading)
    return (
      <div className="p-6 text-sm text-muted-foreground">{t('Loading...')}</div>
    );
  if (query.isError || !query.data)
    return (
      <div className="p-6 text-sm text-destructive">
        {t('Unable to load this project resource.')}
      </div>
    );
  const board = query.data;
  const unassigned =
    board.statuses.find((status) => status.system) ?? board.statuses[0];
  const openNewTask = () => {
    setEditingTask(null);
    setTaskDraft({ ...EMPTY_TASK, statusId: unassigned?.id ?? '' });
    setTaskOpen(true);
  };
  const openTask = (task: ProjectTaskSummary) => {
    setEditingTask(task);
    setTaskDraft({
      title: task.title,
      description: task.description,
      priority: task.priority,
      dueAt: task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 10) : '',
      labels: task.labels.join(', '),
      statusId: task.statusId,
      linkedFilePath: task.linkedFilePath ?? '',
    });
    setTaskOpen(true);
  };
  const saveTask = async () => {
    if (!taskDraft.title.trim()) return;
    const body = {
      title: taskDraft.title.trim(),
      description: taskDraft.description.trim(),
      priority: taskDraft.priority,
      dueAt: taskDraft.dueAt
        ? new Date(`${taskDraft.dueAt}T12:00:00`).getTime()
        : null,
      labels: taskDraft.labels
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
      linkedFilePath: taskDraft.linkedFilePath.trim() || null,
      ...(editingTask ? { statusId: taskDraft.statusId } : {}),
    };
    await request.mutateAsync({
      path: editingTask
        ? `/${projectId}/resources/${resourceId}/tasks/${editingTask.id}`
        : `/${projectId}/resources/${resourceId}/tasks`,
      method: editingTask ? 'PATCH' : 'POST',
      body,
    });
    setTaskOpen(false);
  };
  const removeTask = async () => {
    if (
      !editingTask ||
      !window.confirm('Supprimer définitivement cette tâche ?')
    )
      return;
    await request.mutateAsync({
      path: `/${projectId}/resources/${resourceId}/tasks/${editingTask.id}`,
      method: 'DELETE',
    });
    setTaskOpen(false);
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
        `Supprimer la colonne « ${status.name} » ? Ses tâches seront déplacées vers « Actions non assignées ».`,
      )
    )
      return;
    await request.mutateAsync({
      path: `/${projectId}/resources/${resourceId}/statuses/${status.id}`,
      method: 'DELETE',
    });
  };
  const dropTask = async (statusId: string) => {
    const task = board.tasks.find((item) => item.id === draggedTask);
    if (!task || task.statusId === statusId) return;
    await request.mutateAsync({
      path: `/${projectId}/resources/${resourceId}/tasks/${task.id}`,
      method: 'PATCH',
      body: {
        statusId,
        position: board.tasks.filter((item) => item.statusId === statusId)
          .length,
      },
    });
    setDraggedTask(null);
  };
  const generatePlan = async () => {
    const result = await projectsApi<{
      tasks: Array<{
        title: string;
        description: string;
        priority: string;
      }>;
    }>(`/${projectId}/resources/${resourceId}/ai-plan`, {
      method: 'POST',
      body: JSON.stringify({ prompt: aiPrompt }),
    });
    setAiSuggestions(result.tasks);
  };
  const addSuggestions = async () => {
    for (const suggestion of aiSuggestions)
      await projectsApi(`/${projectId}/resources/${resourceId}/tasks`, {
        method: 'POST',
        body: JSON.stringify(suggestion),
      });
    await refresh();
    setAiOpen(false);
    setAiSuggestions([]);
    setAiPrompt('');
  };

  return (
    <main className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
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
            variant="outline"
            onClick={() => {
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
          <Button onClick={openNewTask}>
            <Plus />
            Nouvelle tâche
          </Button>
        </div>
      </div>
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
          {Object.entries(priorityLabel).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex min-w-max gap-3 pb-4">
        {board.statuses.map((status) => {
          const tasks = filteredTasks
            .filter((task) => task.statusId === status.id)
            .sort((a, b) => a.position - b.position);
          return (
            <section
              key={status.id}
              className="w-[300px] shrink-0 rounded-xl border border-border/70 bg-card/60 p-3"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dropTask(status.id)}
            >
              <div className="mb-3 flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
                  {status.name}
                </h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {tasks.length}
                </span>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  title="Renommer"
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
                    title="Supprimer"
                    onClick={() => removeStatus(status)}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                {tasks.map((task) => {
                  const overdue =
                    task.dueAt !== null &&
                    task.dueAt < Date.now() &&
                    status.name.toLocaleLowerCase() !== 'terminé';
                  return (
                    <button
                      key={task.id}
                      draggable
                      onDragStart={() => setDraggedTask(task.id)}
                      onClick={() => openTask(task)}
                      className="block w-full rounded-lg border bg-background/80 p-3 text-left shadow-sm transition hover:border-primary/50 hover:bg-muted/50"
                    >
                      <div className="flex items-start gap-2">
                        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />
                        <span className="min-w-0 flex-1 text-sm font-medium">
                          {task.title}
                        </span>
                      </div>
                      {task.description && (
                        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                          {task.description}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] ${priorityStyle[task.priority]}`}
                        >
                          {priorityLabel[task.priority]}
                        </span>
                        {task.dueAt && (
                          <span
                            className={`flex items-center gap-1 text-[10px] ${overdue ? 'text-destructive' : 'text-muted-foreground'}`}
                          >
                            <CalendarDays className="h-3 w-3" />
                            {new Date(task.dueAt).toLocaleDateString()}
                          </span>
                        )}
                        {task.labels.map((label) => (
                          <span
                            key={label}
                            className="rounded bg-muted px-1.5 py-0.5 text-[10px]"
                          >
                            {label}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })}
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
      <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingTask ? 'Modifier la tâche' : 'Nouvelle tâche'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Input
              autoFocus
              placeholder="Titre"
              value={taskDraft.title}
              onChange={(e) =>
                setTaskDraft({ ...taskDraft, title: e.target.value })
              }
            />
            <Textarea
              placeholder="Description"
              value={taskDraft.description}
              onChange={(e) =>
                setTaskDraft({ ...taskDraft, description: e.target.value })
              }
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                className="h-8 rounded-lg border bg-background px-2 text-sm"
                value={taskDraft.priority}
                onChange={(e) =>
                  setTaskDraft({
                    ...taskDraft,
                    priority: e.target.value as TaskDraft['priority'],
                  })
                }
              >
                {Object.entries(priorityLabel).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <Input
                type="date"
                value={taskDraft.dueAt}
                onChange={(e) =>
                  setTaskDraft({ ...taskDraft, dueAt: e.target.value })
                }
              />
            </div>
            {editingTask && (
              <select
                className="h-8 rounded-lg border bg-background px-2 text-sm"
                value={taskDraft.statusId}
                onChange={(e) =>
                  setTaskDraft({ ...taskDraft, statusId: e.target.value })
                }
              >
                {board.statuses.map((status) => (
                  <option key={status.id} value={status.id}>
                    {status.name}
                  </option>
                ))}
              </select>
            )}
            <Input
              placeholder="Étiquettes séparées par des virgules"
              value={taskDraft.labels}
              onChange={(e) =>
                setTaskDraft({ ...taskDraft, labels: e.target.value })
              }
            />
            <Input
              placeholder="Fichier lié (chemin facultatif)"
              value={taskDraft.linkedFilePath}
              onChange={(e) =>
                setTaskDraft({ ...taskDraft, linkedFilePath: e.target.value })
              }
            />
          </div>
          <DialogFooter>
            {editingTask && (
              <Button variant="destructive" onClick={removeTask}>
                <Trash2 />
                Supprimer
              </Button>
            )}
            <Button
              onClick={saveTask}
              disabled={!taskDraft.title.trim() || request.isPending}
            >
              Enregistrer
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
            autoFocus
            placeholder="Nom de la colonne"
            value={statusName}
            onChange={(e) => setStatusName(e.target.value)}
          />
          <select
            className="h-8 rounded-lg border bg-background px-2 text-sm"
            value={statusColor}
            onChange={(e) => setStatusColor(e.target.value)}
          >
            {[
              'slate',
              'blue',
              'cyan',
              'green',
              'amber',
              'orange',
              'red',
              'purple',
              'pink',
            ].map((color) => (
              <option key={color} value={color}>
                {color}
              </option>
            ))}
          </select>
          <DialogFooter>
            <Button
              onClick={saveStatus}
              disabled={!statusName.trim() || request.isPending}
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={aiOpen} onOpenChange={setAiOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Planifier avec l’IA</DialogTitle>
          </DialogHeader>
          <Textarea
            rows={5}
            placeholder="Décrivez l’objectif, les contraintes et le résultat attendu…"
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
          />
          {aiSuggestions.length > 0 && (
            <div className="max-h-64 space-y-2 overflow-auto">
              {aiSuggestions.map((item, index) => (
                <div
                  key={`${item.title}-${index}`}
                  className="rounded-lg border p-2"
                >
                  <div className="text-sm font-medium">{item.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.description}
                  </div>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            {aiSuggestions.length ? (
              <Button onClick={addSuggestions}>
                Ajouter ces {aiSuggestions.length} tâches
              </Button>
            ) : (
              <Button onClick={generatePlan} disabled={!aiPrompt.trim()}>
                Générer des propositions
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
