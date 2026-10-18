import {
  CalendarDays,
  Columns3,
  History,
  Lightbulb,
  Plus,
  Settings,
  Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type TaskManagerView = 'advice' | 'board' | 'planning' | 'journal';
const views = [
  { id: 'advice', label: 'Advice', Icon: Lightbulb },
  { id: 'board', label: 'Board', Icon: Columns3 },
  { id: 'planning', label: 'Planning', Icon: CalendarDays },
  { id: 'journal', label: 'Journal', Icon: History },
] as const;

/** Matches the workspace strip: underlined views on the left, tools on the right. */
export function TaskManagerToolbar({
  view,
  onViewChange,
  panelId,
  onPlan,
  onNewTask,
  onSettings,
}: {
  view: TaskManagerView;
  onViewChange: (view: TaskManagerView) => void;
  panelId: string;
  onPlan: () => void;
  onNewTask: () => void;
  onSettings: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-10 min-w-0 shrink-0 items-center border-b bg-background">
      <div
        role="tablist"
        aria-label={t('Task manager views')}
        className="flex min-w-0 flex-1 items-center overflow-x-auto"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
            return;
          const tabs = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role="tab"]',
            ),
          ];
          const current = tabs.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const index =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? tabs.length - 1
                : (current +
                    (event.key === 'ArrowRight' ? 1 : -1) +
                    tabs.length) %
                  tabs.length;
          event.preventDefault();
          tabs[index]?.focus();
          tabs[index]?.click();
        }}
      >
        {views.map(({ id, label, Icon }) => (
          <button
            key={id}
            id={`${panelId}-${id}`}
            type="button"
            role="tab"
            aria-selected={view === id}
            aria-controls={panelId}
            aria-label={t(label)}
            title={t(label)}
            tabIndex={view === id ? 0 : -1}
            onClick={() => onViewChange(id)}
            className={cn(
              'flex h-10 shrink-0 cursor-pointer items-center gap-2 border-b-2 px-3 text-xs transition-colors hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]',
              view === id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon aria-hidden="true" className="h-4 w-4" />
            <span className="hidden sm:inline">{t(label)}</span>
          </button>
        ))}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-0.5 px-1 sm:gap-1 sm:px-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 cursor-pointer"
          onClick={onPlan}
          aria-label={t('Plan with AI')}
          title={t('Plan with AI')}
        >
          <Sparkles />
          <span className="hidden lg:inline">{t('Plan with AI')}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 cursor-pointer"
          onClick={onNewTask}
          aria-label={t('New task')}
          title={t('New task')}
        >
          <Plus />
          <span className="hidden sm:inline">{t('New task')}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 cursor-pointer"
          onClick={onSettings}
          aria-label={t('Task board settings')}
          title={t('Task board settings')}
        >
          <Settings />
        </Button>
      </div>
    </div>
  );
}
