/** Files category runtime settings. */
import { useTranslation } from 'react-i18next';
import { SettingEditor } from './setting-editor';
import { useCategorySettings } from './use-category-settings';
import { SettingsSaveBar } from './settings-save-bar';

export function FilesSettings() {
  const { t } = useTranslation();
  const ctx = useCategorySettings('files');

  return (
    <section className="space-y-4">
      {ctx.isLoading && (
        <div className="rounded-lg border border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground">
          {t('loadingb04ba49f')}
        </div>
      )}

      {ctx.settings.map((setting) => (
        <SettingEditor
          key={setting.key}
          setting={setting}
          draft={ctx.drafts[setting.key] ?? ''}
          disabled={ctx.isSaving}
          onDraftChange={ctx.handleDraftChange}
          onReset={ctx.handleReset}
        />
      ))}
      <SettingsSaveBar
        dirty={ctx.isDirty}
        saving={ctx.isSaving}
        onSave={() => void ctx.handleSaveAll()}
        onDiscard={ctx.discardChanges}
      />
    </section>
  );
}
