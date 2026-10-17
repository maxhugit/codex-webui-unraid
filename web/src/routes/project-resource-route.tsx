import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { ListTodo } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { projectsApi, type ProjectResourceSummary } from '@/lib/projects-api';

const COLUMNS = ['To do', 'In progress', 'Blocked', 'Done'] as const;

/** First project-resource view: a persisted board shell, before task CRUD. */
export function ProjectResourceRoute() {
  const { projectId, resourceId } = useParams({ strict: false }) as {
    projectId: string;
    resourceId: string;
  };
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['project-resource', projectId, resourceId],
    queryFn: () =>
      projectsApi<{ resource: ProjectResourceSummary }>(
        `/${projectId}/resources/${resourceId}`,
      ),
  });

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

  return (
    <main className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <ListTodo className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">{query.data.resource.name}</h1>
          <p className="text-sm text-muted-foreground">{t('Task board')}</p>
        </div>
      </div>
      <div className="grid min-w-[760px] grid-cols-4 gap-3">
        {COLUMNS.map((column) => (
          <section
            key={column}
            className="min-h-64 rounded-xl border border-border/70 bg-card/60 p-3"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium">{t(column)}</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                0
              </span>
            </div>
            <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
              {t('No tasks yet')}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
