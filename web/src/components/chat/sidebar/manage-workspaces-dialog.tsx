import {
  Bot,
  Folder,
  FolderPlus,
  Loader2,
  MessageCircle,
  Star,
  Unlink,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ProjectSummary } from '@/lib/projects-api';
import type { SimpleChatThreadSummary } from '@/lib/simple-chat-api';

interface Props {
  project: ProjectSummary | null;
  simpleChats: SimpleChatThreadSummary[];
  pending: boolean;
  onClose: () => void;
  onAdd: (project: ProjectSummary) => void;
  onSetDefault: (project: ProjectSummary, workspaceId: string) => void;
  onDetach: (project: ProjectSummary, workspaceId: string) => void;
}

/** Centralizes workspace membership without mixing it with project actions. */
export function ManageWorkspacesDialog({
  project,
  simpleChats,
  pending,
  onClose,
  onAdd,
  onSetDefault,
  onDetach,
}: Props) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={project !== null}
      onOpenChange={(open) => !open && !pending && onClose()}
    >
      {project && (
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('Manage workspaces')}</DialogTitle>
            <DialogDescription>
              {t(
                'Add, choose the default workspace, or detach a workspace without deleting its files.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {project.workspaces.map((workspace) => {
              const agents = (project.agentThreads ?? []).filter(
                (thread) => thread.workspacePath === workspace.path,
              );
              const chats = simpleChats.filter(
                (chat) =>
                  chat.projectId === project.id &&
                  (chat.cwd === workspace.path ||
                    chat.cwd.startsWith(`${workspace.path}/`)),
              );
              const conversationCount = agents.length + chats.length;
              return (
                <div
                  key={workspace.id}
                  className="space-y-3 rounded-lg border border-border p-3"
                >
                  <div className="flex items-center gap-3">
                    <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 font-medium">
                        <span className="truncate">{workspace.name}</span>
                        {workspace.primary && (
                          <Badge variant="secondary">{t('Default')}</Badge>
                        )}
                      </div>
                      <div
                        className="truncate font-mono text-[11px] text-muted-foreground"
                        title={workspace.path}
                      >
                        {workspace.path}
                      </div>
                    </div>
                    {!workspace.primary && (
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() => onSetDefault(project, workspace.id)}
                        >
                          {pending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Star className="h-3.5 w-3.5" />
                          )}
                          {t('Set as default')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={pending}
                          onClick={() => onDetach(project, workspace.id)}
                        >
                          <Unlink className="h-3.5 w-3.5" />
                          {t('Detach')}
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="ml-7 space-y-1.5 border-l border-border pl-3">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t('Associated conversations')} ({conversationCount})
                    </div>
                    {conversationCount === 0 ? (
                      <p className="text-xs italic text-muted-foreground">
                        {t('No associated conversation')}
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {agents.map((thread) => (
                          <div
                            key={thread.threadId}
                            className="flex min-w-0 items-center gap-2 text-xs"
                          >
                            <Bot className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{thread.title}</span>
                            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                              {t('Work agent')}
                              {thread.archived ? ` · ${t('Archived')}` : ''}
                            </span>
                          </div>
                        ))}
                        {chats.map((chat) => (
                          <div
                            key={chat.id}
                            className="flex min-w-0 items-center gap-2 text-xs"
                          >
                            <MessageCircle className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{chat.title}</span>
                            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                              {t('Simple conversation')}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {!workspace.primary && conversationCount > 0 && (
                      <p className="pt-1 text-[11px] text-muted-foreground">
                        {t(
                          'Detaching will move these conversations to the default workspace. They will not be deleted.',
                        )}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <DialogFooter className="flex-row justify-between sm:justify-between">
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => onAdd(project)}
            >
              <FolderPlus className="h-4 w-4" />
              {t('Add a workspace')}
            </Button>
            <Button variant="secondary" disabled={pending} onClick={onClose}>
              {t('Close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
