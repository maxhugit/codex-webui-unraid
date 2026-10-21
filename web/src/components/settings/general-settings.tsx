/** Server-wide runtime settings. */
import { useTranslation } from 'react-i18next';
import { SettingEditor } from './setting-editor';
import { SettingsSaveBar } from './settings-save-bar';
import { useCategorySettings } from './use-category-settings';

export function GeneralSettings() {
  const { t } = useTranslation();
  const runtimeSettings = useCategorySettings('general');

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-muted-foreground">
          {t('Runtime Settings')}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t(
            'Idle thread subscriptions are cleaned up in the browser while active or approval-blocked threads stay subscribed.',
          )}
        </p>
      </div>

      {runtimeSettings.isLoading && (
        <div className="rounded-lg border border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground">
          {t('Loading...')}
        </div>
      )}

      {runtimeSettings.settings.map((setting) => (
        <SettingEditor
          key={setting.key}
          setting={setting}
          draft={runtimeSettings.drafts[setting.key] ?? ''}
          disabled={runtimeSettings.isSaving}
          onDraftChange={runtimeSettings.handleDraftChange}
          onReset={runtimeSettings.handleReset}
        />
      ))}
      <SettingsSaveBar
        dirty={runtimeSettings.isDirty}
        saving={runtimeSettings.isSaving}
        onSave={() => void runtimeSettings.handleSaveAll()}
        onDiscard={runtimeSettings.discardChanges}
      />
    </section>
  );
}
