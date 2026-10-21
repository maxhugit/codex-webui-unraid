/** Terminal category runtime settings. */
import { useTranslation } from 'react-i18next';
import { SettingEditor } from './setting-editor';
import { useCategorySettings } from './use-category-settings';
import { SettingsSaveBar } from './settings-save-bar';
import { useTerminalStore } from '@/stores/terminal-store';

export function TerminalSettings() {
  const { t } = useTranslation();
  const refreshTerminalConfig = useTerminalStore((s) => s.refreshConfig);
  const ctx = useCategorySettings('terminal');

  const handleSave = async () => {
    await ctx.handleSaveAll();
    await refreshTerminalConfig();
  };

  const handleReset = (key: string) => {
    ctx.handleReset(key);
    void refreshTerminalConfig();
  };

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
          onReset={handleReset}
        />
      ))}
      <SettingsSaveBar
        dirty={ctx.isDirty}
        saving={ctx.isSaving}
        onSave={() => void handleSave()}
        onDiscard={ctx.discardChanges}
      />
    </section>
  );
}
