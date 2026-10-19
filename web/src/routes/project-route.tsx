import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import {
  Bot,
  FolderKanban,
  FolderOpen,
  LayoutDashboard,
  ListTodo,
  Save,
  Settings,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PeopleManager } from '@/components/projects/people-manager';
import {
  projectsApi,
  projectsQueryKey,
  type ProjectSummary,
} from '@/lib/projects-api';
import { usePlatformSession } from '@/lib/platform-session';
import { cn } from '@/lib/utils';

export type ProjectTab = 'general' | 'administration';

export function ProjectRoute() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const { tab = 'general' } = useSearch({ strict: false }) as {
    tab?: ProjectTab;
  };
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const session = usePlatformSession();
  const queryClient = useQueryClient();
  const projects = useQuery({
    queryKey: projectsQueryKey,
    queryFn: () => projectsApi<{ projects: ProjectSummary[] }>(),
  });
  const project = projects.data?.projects.find((item) => item.id === projectId);
  const [name, setName] = useState('');
  const [saveError, setSaveError] = useState('');

  useEffect(() => setName(project?.name ?? ''), [project?.name]);

  const rename = useMutation({
    mutationFn: (nextName: string) =>
      projectsApi(`/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: nextName }),
      }),
    onSuccess: async () => {
      setSaveError('');
      await queryClient.invalidateQueries({ queryKey: projectsQueryKey });
    },
    onError: (error) =>
      setSaveError(
        error instanceof Error ? error.message : t('Unable to save project'),
      ),
  });

  const selectTab = (next: ProjectTab) =>
    void navigate({
      to: '/projects/$projectId',
      params: { projectId },
      search: { tab: next },
      replace: true,
    });

  if (projects.isPending)
    return (
      <main className="p-6 text-sm text-muted-foreground">{t('Loading…')}</main>
    );
  if (!project)
    return (
      <main className="p-6" role="alert">
        {t('Project not found')}
      </main>
    );

  const date = (value: number) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
      value,
    );
  const agentCount =
    project.agentThreads?.filter((thread) => !thread.archived).length ?? 0;
  const taskBoardCount = project.resources.filter(
    (item) => item.type === 'task_board',
  ).length;

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-10 min-w-0 shrink-0 items-center border-b bg-background">
        <div
          role="tablist"
          aria-label={t('Project sections')}
          className="flex min-w-0 flex-1 items-center"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'general'}
            onClick={() => selectTab('general')}
            className={cn(
              'flex h-10 cursor-pointer items-center gap-2 border-b-2 px-3 text-xs transition-colors hover:bg-accent/50',
              tab === 'general'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <LayoutDashboard className="h-4 w-4" />
            <span>{t('General information')}</span>
          </button>
        </div>
        {session.isAdministrator && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'mr-2 h-8 w-8 cursor-pointer',
              tab === 'administration' && 'bg-accent text-foreground',
            )}
            onClick={() => selectTab('administration')}
            aria-label={t('Project administration')}
            title={t('Project administration')}
          >
            <Settings className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {tab === 'administration' && !session.isAdministrator ? (
          <div role="alert" className="rounded-xl border bg-card p-5">
            {t('Administrator access required')}
          </div>
        ) : tab === 'administration' ? (
          <div className="mx-auto max-w-5xl space-y-6">
            <div>
              <h2 className="text-xl font-semibold">
                {t('Project administration')}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('Manage the project settings and its participants.')}
              </p>
            </div>

            <section className="space-y-4 rounded-xl border bg-card p-5">
              <div>
                <h3 className="font-semibold">{t('General settings')}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('Change the name displayed throughout the application.')}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor="project-name"
                    className="mb-1 block text-sm font-medium"
                  >
                    {t('Project name')}
                  </label>
                  <Input
                    id="project-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
                <Button
                  className="mt-auto cursor-pointer"
                  disabled={
                    rename.isPending ||
                    !name.trim() ||
                    name.trim() === project.name
                  }
                  onClick={() => rename.mutate(name.trim())}
                >
                  <Save className="h-4 w-4" />
                  {t('Save')}
                </Button>
              </div>
              {saveError && (
                <p role="alert" className="text-sm text-destructive">
                  {saveError}
                </p>
              )}
            </section>

            <section className="rounded-xl border bg-card p-5">
              <PeopleManager projectId={projectId} />
            </section>
          </div>
        ) : (
          <div className="mx-auto max-w-6xl space-y-6">
            <section className="rounded-xl border bg-card p-5">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                  <FolderKanban className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-semibold">
                    {project.name}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('General project information and linked resources.')}
                  </p>
                </div>
              </div>
            </section>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCard
                icon={FolderOpen}
                label={t('Workspaces')}
                value={project.workspaces.length}
              />
              <SummaryCard
                icon={Bot}
                label={t('Work agents')}
                value={agentCount}
              />
              <SummaryCard
                icon={ListTodo}
                label={t('Task managers')}
                value={taskBoardCount}
              />
              <SummaryCard
                icon={FolderKanban}
                label={t('Resources')}
                value={project.resources.length}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <section className="rounded-xl border bg-card p-5">
                <h3 className="font-semibold">{t('Project workspaces')}</h3>
                <div className="mt-4 space-y-2">
                  {project.workspaces.map((workspace) => (
                    <div
                      key={workspace.id}
                      className="flex items-center gap-3 rounded-lg border p-3"
                    >
                      <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {workspace.name}
                        </p>
                        <p
                          className="truncate text-xs text-muted-foreground"
                          title={workspace.path}
                        >
                          {workspace.path}
                        </p>
                      </div>
                      {workspace.primary && (
                        <span className="rounded-full bg-primary/10 px-2 py-1 text-xs text-primary">
                          {t('Default')}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border bg-card p-5">
                <h3 className="font-semibold">{t('Details')}</h3>
                <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">{t('Created')}</dt>
                    <dd className="mt-1 font-medium">
                      {date(project.createdAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">
                      {t('Last modified')}
                    </dt>
                    <dd className="mt-1 font-medium">
                      {date(project.updatedAt)}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">
                      {t('Default workspace')}
                    </dt>
                    <dd className="mt-1 break-all font-medium">
                      {project.workspacePath}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FolderKanban;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3 text-muted-foreground">
        <span className="text-sm">{label}</span>
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-3 text-2xl font-semibold">{value}</p>
    </div>
  );
}
