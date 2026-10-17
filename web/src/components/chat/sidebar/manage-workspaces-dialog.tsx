import { Folder, FolderPlus, Loader2, Star, Unlink } from 'lucide-react';
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

interface Props {
  project: ProjectSummary | null;
  pending: boolean;
  onClose: () => void;
  onAdd: (project: ProjectSummary) => void;
  onSetDefault: (project: ProjectSummary, workspaceId: string) => void;
  onDetach: (project: ProjectSummary, workspaceId: string) => void;
}

/** Centralizes workspace membership without mixing it with project actions. */
export function ManageWorkspacesDialog({
  project,
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
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('Manage workspaces')}</DialogTitle>
            <DialogDescription>
              {t(
                'Add, choose the default workspace, or detach a workspace without deleting its files.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {project.workspaces.map((workspace) => (
              <div
                key={workspace.id}
                className="flex items-center gap-3 rounded-lg border border-border p-3"
              >
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
            ))}
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
