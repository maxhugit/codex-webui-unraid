/** Dialog for selecting a workspace directory to create a new thread. */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DirectorySelectionTree } from '@/components/files/directory-selection-tree';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (cwd: string) => void;
  title?: string;
}

/** Uses the same directory tree and mutation menu as copy/move destinations. */
export function DirectoryPickerDialog({
  open,
  onClose,
  onSelect,
  title,
}: Props) {
  const { t } = useTranslation();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  useEffect(() => {
    // Resetting a dialog-scoped draft when a new open cycle starts is an
    // intentional synchronization with the controlled `open` prop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setSelectedPath(null);
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      {open && (
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{title ?? t('selectWorkspaceDirectory')}</DialogTitle>
          </DialogHeader>
          <DirectorySelectionTree
            selectedPath={selectedPath}
            onSelectedPathChange={setSelectedPath}
            showCreateButton
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button
              size="sm"
              disabled={!selectedPath}
              onClick={() => {
                if (selectedPath) {
                  onSelect(selectedPath);
                  onClose();
                }
              }}
            >
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
