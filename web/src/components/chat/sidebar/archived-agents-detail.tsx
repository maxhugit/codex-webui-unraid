import { Archive, ChevronLeft, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type {
  ProjectAgentThreadSummary,
  ProjectSummary,
} from '@/lib/projects-api';
import { workspaceLabel } from './sidebar-types';

type AssociationFilter = 'all' | 'linked' | 'unlinked';

interface Props {
  project: ProjectSummary;
  pending: boolean;
  onBack: () => void;
  onOpen: (agent: ProjectAgentThreadSummary) => void;
  onRestore: (agent: ProjectAgentThreadSummary) => void;
  onDelete: (agent: ProjectAgentThreadSummary) => void;
}

export function ArchivedAgentsDetail({
  project,
  pending,
  onBack,
  onOpen,
  onRestore,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [workspace, setWorkspace] = useState('all');
  const [association, setAssociation] = useState<AssociationFilter>('all');

  const agents = useMemo(
    () => (project.agentThreads ?? []).filter((agent) => agent.archived),
    [project.agentThreads],
  );
  const workspaces = useMemo(
    () => [...new Set(agents.map((agent) => agent.workspacePath))].sort(),
    [agents],
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredAgents = agents.filter((agent) => {
    if (workspace !== 'all' && agent.workspacePath !== workspace) return false;
    if (association === 'linked' && !agent.taskId) return false;
    if (association === 'unlinked' && agent.taskId) return false;
    if (!normalizedQuery) return true;
    return [agent.title, agent.taskTitle, agent.workspacePath].some((value) =>
      value?.toLocaleLowerCase().includes(normalizedQuery),
    );
  });

  return (
    <div className="space-y-3 pb-3">
      <button
        type="button"
        className="flex cursor-pointer items-center gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={onBack}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        {t('back')}
      </button>

      <div className="space-y-0.5 px-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground/90">
          <Archive className="h-4 w-4" />
          <span>{t('archivedAgents')}</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {agents.length}
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{project.name}</p>
      </div>

      <div className="space-y-2 px-1">
        <label className="relative block">
          <span className="sr-only">{t('searchArchivedAgents')}</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchArchivedAgents')}
            className="h-8 pl-8 text-xs"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="sr-only">{t('workspaces')}</span>
            <select
              value={workspace}
              onChange={(event) => setWorkspace(event.target.value)}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
            >
              <option value="all">{t('projectWorkspaces')}</option>
              {workspaces.map((path) => (
                <option key={path} value={path}>
                  {workspaceLabel(path)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">{t('allTaskAssociations')}</span>
            <select
              value={association}
              onChange={(event) =>
                setAssociation(event.target.value as AssociationFilter)
              }
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
            >
              <option value="all">{t('allTaskAssociations')}</option>
              <option value="linked">{t('withPrimaryTask')}</option>
              <option value="unlinked">{t('withoutPrimaryTask')}</option>
            </select>
          </label>
        </div>
      </div>

      <div className="space-y-1">
        {filteredAgents.map((agent) => (
          <div
            key={agent.threadId}
            className="group flex min-w-0 items-center gap-1 rounded-lg border border-transparent px-1 py-1 hover:border-border hover:bg-accent/30"
          >
            <button
              type="button"
              className="min-w-0 flex-1 cursor-pointer rounded-md px-2 py-1.5 text-left"
              onClick={() => onOpen(agent)}
            >
              <span className="block truncate text-xs font-medium text-foreground/90">
                {agent.title || agent.threadId.slice(0, 8)}
              </span>
              <span className="mt-0.5 flex min-w-0 gap-1.5 text-[10px] text-muted-foreground">
                <span className="truncate">
                  {workspaceLabel(agent.workspacePath)}
                </span>
                {agent.taskTitle && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{agent.taskTitle}</span>
                  </>
                )}
              </span>
            </button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0"
              disabled={pending}
              onClick={() => onRestore(agent)}
              aria-label={t('restore')}
              title={t('restore')}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
              disabled={pending}
              onClick={() => onDelete(agent)}
              aria-label={t('deletePermanently')}
              title={t('deletePermanently')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        {filteredAgents.length === 0 && (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            {t('noArchivedThreads')}
          </p>
        )}
      </div>
    </div>
  );
}
