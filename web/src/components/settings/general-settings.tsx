/** Server-wide runtime settings and WebUI session logout. */
import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SettingEditor } from './setting-editor';
import { SettingsSaveBar } from './settings-save-bar';
import { useCategorySettings } from './use-category-settings';
import { AuthenticationSettings } from './authentication-settings';

interface Props {
  onLogout: () => void | Promise<void>;
}

export function GeneralSettings({ onLogout }: Props) {
  const { t } = useTranslation();
  const runtimeSettings = useCategorySettings('general');

  return (
    <>
      <AuthenticationSettings />

      <Separator />

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

      <Separator />

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          {t('Account')}
        </h2>
        <div className="flex items-center justify-between rounded-lg border border-destructive/30 bg-card/50 px-4 py-3">
          <div className="flex items-center gap-3">
            <LogOut className="h-4 w-4 text-destructive" />
            <span className="text-sm">{t('Sign out of this session')}</span>
          </div>
          <Button
            variant="destructive"
            size="sm"
            className="h-8"
            onClick={() => void onLogout()}
          >
            {t('Logout')}
          </Button>
        </div>
      </section>
    </>
  );
}
