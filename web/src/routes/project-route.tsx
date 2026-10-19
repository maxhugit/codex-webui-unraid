import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import {
  Bot,
  FolderKanban,
  FolderOpen,
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
  type ProjectSummary,
} from '@/lib/projects-api';
import { usePlatformSession } from '@/lib/platform-session';

export function ProjectRoute() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const { t, i18n } = useTranslation();
  const session = usePlatformSession();
  const projects = useQuery({
    queryKey: projectsQueryKey,
    queryFn: () => projectsApi<{ projects: ProjectSummary[] }>(),
  });
  const project = projects.data?.projects.find((item) => item.id === projectId);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
            aria-selected="true"
            className="flex h-10 cursor-pointer items-center gap-2 border-b-2 border-primary px-3 text-xs text-foreground transition-colors hover:bg-accent/50"
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
