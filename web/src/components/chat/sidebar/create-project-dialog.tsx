import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
  onNameChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}

/** The primary workspace path is assigned by the server. */
export function CreateProjectDialog({
  open,
  pending,
  name,
  onNameChange,
  onSave,
  onClose,
}: CreateProjectDialogProps) {
  const { t } = useTranslation();
  const canSave = Boolean(name.trim());

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) {
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
                'A permanent primary workspace is created automatically at /workspaces/<project-id>. You can attach secondary workspaces afterwards.',
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
