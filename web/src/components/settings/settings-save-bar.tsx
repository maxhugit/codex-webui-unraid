/** Shared, mobile-safe action bar for one administration tab. */
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

export function SettingsSaveBar({
  dirty,
  saving,
  onSave,
  onDiscard,
  label = 'Save',
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onDiscard?: () => void;
  label?: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="h-24" aria-hidden="true" />
      <div
        role="region"
        aria-label={t('Save settings')}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg backdrop-blur"
      >
        <div className="mx-auto flex max-w-4xl items-center justify-end gap-3">
          <span role="status" className="mr-auto text-xs text-muted-foreground">
            {dirty ? t('Unsaved changes') : t('No pending changes')}
          </span>
          {onDiscard && (
            <Button
              variant="outline"
              disabled={!dirty || saving}
              onClick={onDiscard}
            >
              {t('Cancel')}
            </Button>
          )}
          <Button disabled={!dirty || saving} onClick={onSave}>
            {saving ? t('Saving...') : t(label)}
          </Button>
        </div>
      </div>
    </>
  );
}
