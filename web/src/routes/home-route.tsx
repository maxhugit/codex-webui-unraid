import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  FolderKanban,
  ListTodo,
  RefreshCw,
  Search,
  TriangleAlert,
  Bot,
  CalendarDays,
} from 'lucide-react';
import { projectsApi } from '@/lib/projects-api';
import { useTimelineStore } from '@/stores/timeline-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ProjectOverview = {
  id: string;
  name: string;
  lastActivityAt: number;
  active: boolean;
  health: 'risk' | 'attention' | 'clear';
  taskCount: number;
  openTaskCount: number;
  openSubtaskCount: number;
  overdueCount: number;
  dueSoonCount: number;
  reviewCount: number;
  agentErrorCount: number;
  progress: number | null;
  remainingMinutes: number;
  unestimatedCount: number;
  nextDueAt: number | null;
  resources: Array<{ id: string; name: string; type: string }>;
};
type Dashboard = {
  generatedAt: number;
  projects: ProjectOverview[];
  totals: {
    projects: number;
    activeProjects: number;
    quietProjects: number;
    atRiskProjects: number;
    openTasks: number;
    overdue: number;
    awaitingReview: number;
    remainingMinutes: number;
    unestimated: number;
  };
  alerts: Array<{
    projectId: string;
    projectName: string;
    resourceId: string;
    taskId: string;
    title: string;
    isSubtask: boolean;
    reason: 'overdue' | 'agent_error' | 'review' | 'due_soon';
    dueAt: number | null;
  }>;
};

export function HomeRoute() {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [allAlerts, setAllAlerts] = useState(false);
  const selectThread = useTimelineStore((s) => s.selectThread);
  useEffect(() => {
    selectThread(null);
  }, [selectThread]);
  const query = useQuery({
    queryKey: ['project-dashboard'],
    queryFn: () => projectsApi<Dashboard>('/dashboard'),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const locale = (i18n.resolvedLanguage ?? i18n.language).startsWith('fr')
    ? 'fr-FR'
    : 'en-US';
  const number = (n: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);
  const hours = (minutes: number) => `${number(minutes / 60)} h`;
  const date = (value: number) =>
    new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(value);
  const reason = {
    overdue: t('overdue'),
    agent_error: t('agentError'),
    review: t('awaitingValidation'),
    due_soon: t('dueWithin7Days'),
  };
  const data = query.data;
  const visibleProjects =
    data?.projects.filter(
      (p) =>
        p.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
        (filter === 'all' ||
          (filter === 'active' && p.active) ||
          (filter === 'quiet' && !p.active) ||
          (filter === 'risk' && p.health === 'risk')),
    ) ?? [];
  return (
    <main
      className="min-h-0 flex-1 overflow-y-auto bg-background"
      aria-labelledby="home-title"
    >
      <div className="mx-auto max-w-7xl space-y-7 px-4 py-6 sm:px-7 sm:py-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              {t('projectOverview')}
            </p>
            <h1
              id="home-title"
              className="text-3xl font-semibold tracking-tight"
            >
              {t('home')}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t('seeWhatIsMovingForwardAndWhereYourAttentionIsNeeded')}
            </p>
          </div>
          <Button
            variant="outline"
            className="cursor-pointer"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${query.isFetching ? 'animate-spin' : ''}`}
            />
            {t('refresh')}
          </Button>
        </header>
        {query.isError && (
          <div
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            {t('unableToLoadTheOverview')} {query.error.message}
          </div>
        )}
        {!data && query.isPending && (
          <p role="status" className="py-12 text-center text-muted-foreground">
            {t('loading')}
          </p>
        )}
        {data && (
          <>
            <section
              className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
              aria-label={t('keyIndicators')}
            >
              {[
                {
                  icon: FolderKanban,
                  label: t('projects'),
                  value: data.totals.projects,
                  detail: t('activeActiveQuietWithoutRecentActivity', {
                    active: data.totals.activeProjects,
                    quiet: data.totals.quietProjects,
                  }),
                },
                {
                  icon: ListTodo,
                  label: t('openTasks'),
                  value: data.totals.openTasks,
                  detail: t('countOverdueItems', {
                    count: data.totals.overdue,
                  }),
                },
                {
                  icon: Bot,
                  label: t('aiWorkToValidate'),
                  value: data.totals.awaitingReview,
                  detail: t('subtasksAwaitingYourReview'),
                },
                {
                  icon: Clock3,
                  label: t('estimatedRemainingWorkload'),
                  value: hours(data.totals.remainingMinutes),
                  detail: data.totals.unestimated
                    ? t('countItemsWithoutAnEstimate', {
                        count: data.totals.unestimated,
                      })
                    : t('basedOnEstimatesAndProgress'),
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border bg-card p-5 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                    <span>{item.label}</span>
                    <item.icon className="h-4 w-4" />
                  </div>
                  <p className="mt-3 text-3xl font-semibold tabular-nums">
                    {item.value}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {item.detail}
                  </p>
                </div>
              ))}
            </section>
            <section className="overflow-hidden rounded-2xl border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
                <h2 className="flex items-center gap-2 font-semibold">
                  <TriangleAlert className="h-4 w-4 text-amber-500" />
                  {t('needsAttention')}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {t('countProjectsAtRisk', {
                    count: data.totals.atRiskProjects,
                  })}
                </span>
              </div>
              {!data.alerts.length ? (
                <p className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  {t('noAlertsInTheCurrentTaskData')}
                </p>
              ) : (
                <div className="divide-y">
                  {data.alerts
                    .slice(0, allAlerts ? undefined : 6)
                    .map((alert) => (
                      <Link
                        key={alert.taskId}
                        to="/projects/$projectId/resources/$resourceId"
                        params={{
                          projectId: alert.projectId,
                          resourceId: alert.resourceId,
                        }}
                        search={{ task: alert.taskId }}
                        className="group flex cursor-pointer items-center gap-3 px-5 py-3 transition-colors hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${alert.reason === 'overdue' || alert.reason === 'agent_error' ? 'bg-red-500' : 'bg-amber-500'}`}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium group-hover:underline">
                            {alert.title}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {alert.projectName} ·{' '}
                            {alert.isSubtask ? t('subtask') : t('task')}
                            {alert.dueAt !== null
                              ? ` · ${date(alert.dueAt)}`
                              : ''}
                          </p>
                        </div>
                        <span className="text-right text-xs text-muted-foreground">
                          {reason[alert.reason]}
                        </span>
                        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </Link>
                    ))}
                  {data.alerts.length > 6 && (
                    <button
                      type="button"
                      className="w-full cursor-pointer py-3 text-sm text-primary hover:bg-accent/50"
                      onClick={() => setAllAlerts((v) => !v)}
                    >
                      {allAlerts
                        ? t('showLess')
                        : t('showAllAlertsCount', {
                            count: data.alerts.length,
                          })}
                    </button>
                  )}
                </div>
              )}
            </section>
            <section aria-labelledby="project-list-title" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="project-list-title" className="text-lg font-semibold">
                  {t('yourProjects')}
                </h2>
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('searchProjects')}
                    aria-label={t('searchProjects')}
                  />
                </div>
              </div>
              <div
                className="flex flex-wrap gap-2"
                role="group"
                aria-label={t('filterProjects')}
              >
                {['all', 'active', 'quiet', 'risk'].map((value, index) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={filter === value ? 'default' : 'outline'}
                    className="cursor-pointer"
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {
                      [
                        t('allProjects'),
                        t('recentlyActive'),
                        t('noRecentActivity'),
                        t('atRisk'),
                      ][index]
                    }
                  </Button>
                ))}
              </div>
              {!visibleProjects.length && (
                <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                  {!data.projects.length
                    ? t('createYourFirstProjectUsingTheSidebarToGetStarted')
                    : t('noProjectsMatchTheseFilters')}
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {visibleProjects.map((project) => (
                  <article
                    key={project.id}
                    className="flex min-w-0 flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="min-w-0 break-words text-lg font-semibold">
                        {project.name}
                      </h3>
                      <span
                        className={`shrink-0 rounded-full px-2 py-1 text-xs ${project.health === 'risk' ? 'bg-red-500/10 text-red-700 dark:text-red-300' : project.health === 'attention' ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'}`}
                      >
                        {project.health === 'risk'
                          ? t('atRisk')
                          : project.health === 'attention'
                            ? t('toWatch')
                            : t('noAlerts')}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {!project.active
                        ? t('noActivityFor14Days')
                        : t('recentlyActive')}
                      {project.overdueCount
                        ? ` · ${t('countOverdueItems', { count: project.overdueCount })}`
                        : ''}
                      {project.agentErrorCount
                        ? ` · ${t('countAgentErrors', { count: project.agentErrorCount })}`
                        : ''}
                    </p>
                    <div>
                      <div className="mb-2 flex justify-between text-xs text-muted-foreground">
                        <span>{t('overallProgress')}</span>
                        <span className="tabular-nums">
                          {project.progress === null
                            ? t('noTasks')
                            : `${project.progress} %`}
                        </span>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={`${t('overallProgress')} · ${project.name}`}
                        aria-valuenow={project.progress ?? 0}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        className="h-1.5 overflow-hidden rounded-full bg-muted"
                      >
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${project.progress ?? 0}%` }}
                        />
                      </div>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-4 text-sm">
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          {t('openTasks')}
                        </dt>
                        <dd className="mt-1 font-medium">
                          {project.openTaskCount}{' '}
                          <span className="text-xs font-normal text-muted-foreground">
                            ·{' '}
                            {t('countSubtasks', {
                              count: project.openSubtaskCount,
                            })}
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          {t('remainingWorkload')}
                        </dt>
                        <dd className="mt-1 font-medium">
                          {hours(project.remainingMinutes)}
                          {project.unestimatedCount > 0 && (
                            <span className="mt-1 block text-xs font-normal text-muted-foreground">
                              {t('countItemsWithoutAnEstimate', {
                                count: project.unestimatedCount,
                              })}
                            </span>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                          <CalendarDays className="h-3 w-3" />
                          {t('nextDeadline')}
                        </dt>
                        <dd className="mt-1">
                          {project.nextDueAt === null
                            ? t('notScheduled')
                            : date(project.nextDueAt)}
                        </dd>
                      </div>
                      <div>
                        <dt className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Activity className="h-3 w-3" />
                          {t('lastActivity')}
                        </dt>
                        <dd className="mt-1">{date(project.lastActivityAt)}</dd>
                      </div>
                    </dl>
                    <div className="mt-auto flex flex-wrap gap-2 border-t pt-4">
                      {project.resources.map((resource) => (
                        <Link
                          key={resource.id}
                          to="/projects/$projectId/resources/$resourceId"
                          params={{
                            projectId: project.id,
                            resourceId: resource.id,
                          }}
                          search={{ task: undefined }}
                          className="inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs hover:bg-accent"
                        >
                          {resource.name}
                          <ArrowUpRight className="h-3 w-3" />
                        </Link>
                      ))}
                      {!project.resources.length && (
                        <p className="text-xs text-muted-foreground">
                          {t('conversationsAreAvailableInTheSidebar')}
                        </p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
            <footer className="space-y-1 border-t pt-4 text-xs leading-relaxed text-muted-foreground">
              <p>
                {t(
                  'activityChangesWithin14DaysRiskOverdueWorkOrAnAgentErrorToWatchADeadlineWithin7a44255b7',
                )}
              </p>
              <p>
                {t(
                  'workloadIsEstimatedFromRemainingProgressSubtasksReplaceTheirParentEstimateMissid4ed162a',
                )}
              </p>
              <p>
                {t('updatedAt')}{' '}
                {new Intl.DateTimeFormat(locale, {
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(data.generatedAt)}{' '}
                · {t('automaticRefreshEveryMinute')}
              </p>
            </footer>
          </>
        )}
      </div>
    </main>
  );
}
