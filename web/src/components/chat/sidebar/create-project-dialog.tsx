import { useState } from 'react';
import { FolderOpen, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DirectorySelectionTree } from '@/components/files/directory-selection-tree';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface CreateProjectDialogProps {
  open: boolean;
  pending: boolean;
  name: string;
  workspacePath: string;
  onNameChange: (value: string) => void;
  onWorkspacePathChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}

/** Project creation form with an editable or browsable primary workspace. */
export function CreateProjectDialog({
  open,
  pending,
  name,
  workspacePath,
  onNameChange,
  onWorkspacePathChange,
  onSave,
  onClose,
}: CreateProjectDialogProps) {
  const { t } = useTranslation();
  const [showPicker, setShowPicker] = useState(false);
  const canSave = Boolean(name.trim() && workspacePath.trim());

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) {
          setShowPicker(false);
          onClose();
        }
      }}
    >
      {open && (
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('Create a project')}</DialogTitle>
            <DialogDescription>
              {t(
                'Choose the primary workspace. It will be created if it does not exist.',
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="new-project-name" className="text-sm font-medium">
                {t('Project name')}
              </label>
              <Input
                id="new-project-name"
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                disabled={pending}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="new-project-workspace"
                className="text-sm font-medium"
              >
                {t('Primary workspace path')}
              </label>
              <div className="flex gap-2">
                <Input
                  id="new-project-workspace"
                  className="font-mono text-xs"
                  value={workspacePath}
                  onChange={(event) =>
                    onWorkspacePathChange(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && canSave && !pending) onSave();
                  }}
                  disabled={pending}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={pending}
                  title={t('Choose a folder')}
                  onClick={() => setShowPicker((value) => !value)}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {showPicker && (
              <DirectorySelectionTree
                selectedPath={workspacePath || null}
                onSelectedPathChange={(path) => {
                  if (path) onWorkspacePathChange(path);
                }}
                showCreateButton
                showSelectedPath
              />
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button disabled={!canSave || pending} onClick={onSave}>
              {pending && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              {t('Create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
