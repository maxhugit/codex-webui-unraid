/** Rename and confirmation dialogs for the thread sidebar. */
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { ConfirmAction } from './sidebar-types';

interface RenameDialogProps {
  open: boolean;
  pending: boolean;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
  title?: string;
  description?: string;
  saveLabel?: string;
}

/** Dialog for renaming a thread. */
export function RenameDialog({
  open,
  pending,
  value,
  onChange,
  onSave,
  onClose,
  title,
  description,
  saveLabel,
}: RenameDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title ?? t('renameThread')}</AlertDialogTitle>
          <AlertDialogDescription>
            {description ?? t('enterANonEmptyThreadName')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim() && !pending) onSave();
          }}
          disabled={pending}
          autoFocus
        />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t('cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={!value.trim() || pending}
            onClick={onSave}
          >
            {pending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : null}
            {saveLabel ?? t('save')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface ConfirmDialogProps {
  action: ConfirmAction;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Dialog for confirming archive or compact actions. */
export function ConfirmDialog({
  action,
  pending,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      open={action !== null}
      onOpenChange={(o) => !o && !pending && onClose()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {action?.type === 'compact'
              ? t('compactThisThread')
              : t('archiveThisThread')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {action?.type === 'compact'
              ? t('compactionPermanentlyCompressesContextAndCannotBeUndone')
              : t('archivedThreadsMoveToTheReadOnlyArchiveGroup')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t('cancel')}
          </AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={onConfirm}>
            {pending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : null}
            {action?.type === 'compact' ? t('compact') : t('archive')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
