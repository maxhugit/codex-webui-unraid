/** Overview view: pinned archive group + workspace groups with collapse. */
import {
  Archive,
  Bot,
  ChevronDown,
  ChevronRight,
  Eye,
  MessageCircle,
  Plus,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useDroppable } from '@dnd-kit/react';
import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { ThreadDto } from '@/generated/api';
import { cn } from '@/lib/utils';
import type { WorkspaceGroup } from './sidebar-types';
import { workspaceLabel } from './sidebar-types';

const collapseVariants = {
  open: { height: 'auto', opacity: 1 },
  closed: { height: 0, opacity: 0 },
} as const;

function ThreadSkeleton() {
  return (
    <div className="space-y-1.5 pl-3">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex items-center gap-1.5 px-2 py-1.5">
          <Skeleton className="h-3 w-3 shrink-0 rounded" />
          <Skeleton className="h-3 w-24 rounded" />
        </div>
      ))}
    </div>
  );
}

interface Props {
  archivedThreads: ThreadDto[];
  workspaceGroups: WorkspaceGroup[];
  collapsedGroups: Set<string>;
  isLoading: boolean;
  onToggleCollapse: (key: string) => void;
  onOpenArchivedDetail: () => void;
  onOpenWorkspaceDetail: (cwd: string) => void;
  onCreateAgentInWorkspace: (cwd: string) => void;
  onCreateSimpleChatInWorkspace: (cwd: string) => void;
  renderThreadRow: (thread: ThreadDto, archived: boolean) => React.ReactNode;
  renderSimpleChatRow: (
    thread: WorkspaceGroup['simpleChats'][number],
  ) => React.ReactNode;
  movingThread: boolean;
}

export function WorkspaceOverview({
  archivedThreads,
  workspaceGroups,
  collapsedGroups,
  isLoading,
  onToggleCollapse,
  onOpenArchivedDetail,
  onOpenWorkspaceDetail,
  onCreateAgentInWorkspace,
  onCreateSimpleChatInWorkspace,
  renderThreadRow,
  renderSimpleChatRow,
  movingThread,
}: Props) {
  const { t } = useTranslation();
  const archivedCollapsed = collapsedGroups.has('__archived__');

  if (isLoading) {
    return (
      <div className="space-y-4 pb-2 pt-1">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex items-center gap-1.5 px-2">
              <Skeleton className="h-3.5 w-3.5 rounded" />
              <Skeleton className="h-4 w-20 rounded" />
            </div>
            <ThreadSkeleton />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-2">
      {/* Pinned archive group */}
      <section>
        <div className="mb-0.5 flex items-center gap-1 px-2">
          <button
            type="button"
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-sm font-medium text-foreground/80 hover:text-foreground"
            onClick={() => onToggleCollapse('__archived__')}
          >
            {archivedCollapsed ? (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform" />
            )}
            <Archive className="h-3.5 w-3.5 shrink-0" />
            {t('Archived')}
          </button>
          <button
            type="button"
            className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
            onClick={onOpenArchivedDetail}
            aria-label={t('View more')}
            title={t('View more')}
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
        </div>
        <AnimatePresence initial={false}>
          {!archivedCollapsed && (
            <motion.div
              key="archived-content"
              initial="closed"
              animate="open"
              exit="closed"
              variants={collapseVariants}
              transition={{ duration: 0.15, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="space-y-0.5">
                {archivedThreads.map((thread) => renderThreadRow(thread, true))}
                {archivedThreads.length === 0 && (
                  <p className="py-2 pl-5 text-xs text-muted-foreground">
                    {t('No archived threads')}
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Workspace groups */}
      {workspaceGroups.map((group) => {
        const collapsed = collapsedGroups.has(group.cwd);
        return (
          <WorkspaceDropTarget
            key={group.cwd}
            cwd={group.cwd}
            disabled={movingThread}
          >
            <div
              className="mb-0.5 flex items-center gap-1 px-2"
              title={group.cwd}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-sm font-medium text-foreground/80 hover:text-foreground"
                onClick={() => onToggleCollapse(group.cwd)}
              >
                {collapsed ? (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform" />
                )}
                <span className="truncate">{workspaceLabel(group.cwd)}</span>
              </button>
              <div className="flex shrink-0 items-center gap-0.5">
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                      aria-label={t('Add to this workspace')}
                      title={t('Add to this workspace')}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-56 p-1">
                    <Button
                      variant="ghost"
                      className="h-8 w-full justify-start gap-2 px-2 text-xs"
                      onClick={() => onCreateAgentInWorkspace(group.cwd)}
                    >
                      <Bot className="h-3.5 w-3.5" />
                      {t('Work agent')}
                    </Button>
                    <Button
                      variant="ghost"
                      className="h-8 w-full justify-start gap-2 px-2 text-xs"
                      onClick={() => onCreateSimpleChatInWorkspace(group.cwd)}
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      {t('Simple conversation')}
                    </Button>
                  </PopoverContent>
                </Popover>
                {group.threads.length + group.simpleChats.length >= 5 && (
                  <button
                    type="button"
                    className="cursor-pointer rounded p-0.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    onClick={() => onOpenWorkspaceDetail(group.cwd)}
                    aria-label={t('View more')}
                    title={t('View more')}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.div
                  key={`ws-${group.cwd}`}
                  initial="closed"
                  animate="open"
                  exit="closed"
                  variants={collapseVariants}
                  transition={{ duration: 0.15, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <div className="space-y-0.5">
                    {group.threads
                      .slice(0, 5)
                      .map((thread) => renderThreadRow(thread, false))}
                    {group.simpleChats
                      .slice(0, Math.max(0, 5 - group.threads.length))
                      .map((thread) => renderSimpleChatRow(thread))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </WorkspaceDropTarget>
        );
      })}

      {workspaceGroups.length === 0 && archivedThreads.length === 0 && (
        <p className="px-2 py-8 text-center text-xs text-muted-foreground">
          {t('No threads yet')}
        </p>
      )}
    </div>
  );
}

function WorkspaceDropTarget({
  cwd,
  disabled,
  children,
}: {
  cwd: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const { ref, isDropTarget } = useDroppable({
    id: `workspace-${cwd}`,
    disabled,
    data: { kind: 'workspace', cwd },
  });
  return (
    <section
      ref={ref}
      className={cn(
        'rounded-md transition-colors',
        isDropTarget && 'bg-primary/10 ring-1 ring-primary/30',
      )}
    >
      {children}
    </section>
  );
}
