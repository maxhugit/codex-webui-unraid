import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import {
  Bot,
  FolderKanban,
  FolderOpen,
  History,
  LayoutDashboard,
  ListTodo,
  Settings,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ProjectSettingsDialog } from '@/components/projects/project-settings-dialog';
import {
  projectsApi,
  projectsQueryKey,
  type ProjectActivitySummary,
  type ProjectSummary,
} from '@/lib/projects-api';
import { usePlatformSession } from '@/lib/platform-session';

export function ProjectRoute() {
  const { projectId } = useParams({ strict: false });
  const { t, i18n } = useTranslation();
  const session = usePlatformSession();
  const projects = useQuery({
    queryKey: projectsQueryKey,
    queryFn: () => projectsApi<{ projects: ProjectSummary[] }>(),
  });
  const project = projects.data?.projects.find((item) => item.id === projectId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'journal'>('general');
  const activity = useQuery({
    queryKey: ['project-activity', projectId],
    queryFn: () =>
      projectsApi<{ activity: ProjectActivitySummary[] }>(
        `/${projectId}/activity`,
      ),
    enabled: activeTab === 'journal',
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
            aria-selected={activeTab === 'general'}
            className={`flex h-10 cursor-pointer items-center gap-2 border-b-2 px-3 text-xs transition-colors hover:bg-accent/50 ${activeTab === 'general' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
            onClick={() => setActiveTab('general')}
          >
            <LayoutDashboard className="h-4 w-4" />
            <span>{t('General information')}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'journal'}
            className={`flex h-10 cursor-pointer items-center gap-2 border-b-2 px-3 text-xs transition-colors hover:bg-accent/50 ${activeTab === 'journal' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
            onClick={() => setActiveTab('journal')}
          >
            <History className="h-4 w-4" />
            <span>{t('Journal')}</span>
          </button>
        </div>
        {session.isAdministrator && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mr-2 h-8 w-8 cursor-pointer"
            onClick={() => setSettingsOpen(true)}
            aria-label={t('Project administration')}
            title={t('Project administration')}
          >
            <Settings className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          {activeTab === 'general' ? (
            <>
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
            </>
          ) : (
            <ProjectJournal
              rows={activity.data?.activity ?? []}
              pending={activity.isPending}
              error={activity.isError}
              locale={i18n.language}
              t={t}
            />
          )}
        </div>
      </div>
      {session.isAdministrator && settingsOpen && (
        <ProjectSettingsDialog
          project={project}
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}

function ProjectJournal({
  rows,
  pending,
  error,
  locale,
  t,
}: {
  rows: ProjectActivitySummary[];
  pending: boolean;
  error: boolean;
  locale: string;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const labels: Record<string, string> = {
    project_created: 'Project created',
    project_renamed: 'Project renamed',
    workspace_added: 'Workspace added',
    workspace_default_changed: 'Default workspace changed',
    workspace_detached: 'Workspace detached',
    participant_added: 'Participant added',
    participant_removed: 'Participant removed',
    resource_created: 'Resource created',
    resource_updated: 'Resource updated',
    resource_deleted: 'Resource deleted',
    resource_moved_out: 'Resource moved to another project',
    resource_moved_in: 'Resource moved into the project',
    mcp_configuration_updated: 'MCP connector configuration updated',
  };
  if (pending)
    return <p className="text-sm text-muted-foreground">{t('Loading…')}</p>;
  if (error)
    return (
      <p className="text-sm text-destructive">
        {t('Unable to load project activity')}
      </p>
    );
  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="border-b px-5 py-4">
        <h2 className="font-semibold">{t('Project journal')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('Major operations performed on this project are recorded here.')}
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">
          {t('No project activity yet.')}
        </p>
      ) : (
        <div className="divide-y">
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid gap-2 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {t(labels[row.action] ?? row.action)}
                </p>
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={row.label}
                >
                  {row.label}
                </p>
              </div>
              <div className="text-xs text-muted-foreground sm:text-right">
                <p>
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(row.createdAt)}
                </p>
                <p>{row.actorName}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
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
