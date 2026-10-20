/**
 * Settings page shell with tab routing to category sub-components.
 */
import { useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useThemeStore } from '@/stores/theme-store';
import { clearApiToken } from '@/auth-token';
import { resetSocket } from '@/socket';
import type { SettingsSection } from './settings-sections';
import { GeneralSettings } from './general-settings';
import { AccountSettings } from './account/account-settings';
import { CodexSettings } from './codex-settings';
import { CatalogSettings } from './catalog/catalog-settings';
import { TerminalSettings } from './terminal-settings';
import { FilesSettings } from './files-settings';
import { SecuritySettings } from './security-settings';
import { SimpleChatSettings } from './simple-chat-settings';
import { PluginsTab } from '@/components/integrations/plugins-tab';
import { AppsTab } from '@/components/integrations/apps-tab';
import { McpsTab } from '@/components/integrations/mcps-tab';
import { PeopleManager } from '@/components/projects/people-manager';
import { DatabaseSettings } from './database-settings';

const INTEGRATION_SECTIONS = ['plugins', 'apps', 'mcps'] as const;
type IntegrationSection = (typeof INTEGRATION_SECTIONS)[number];

export function SettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const dark = useThemeStore((s) => s.dark);
  const toggleDark = useThemeStore((s) => s.toggleDark);
  const section = useRouterState({
    select: (s) =>
      (s.location.search as { section?: SettingsSection }).section ?? 'general',
  });
  const [integrationSection, setIntegrationSection] =
    useState<IntegrationSection>('plugins');

  const handleLogout = () => {
    clearApiToken();
    resetSocket();
    void navigate({ to: '/login', search: { redirect: '/' } });
  };

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-4 sm:px-6">
        {section === 'general' && (
          <GeneralSettings
            dark={dark}
            toggleDark={toggleDark}
            language={i18n.resolvedLanguage ?? i18n.language}
            changeLanguage={(language) => void i18n.changeLanguage(language)}
            onLogout={handleLogout}
          />
        )}
        {section === 'account' && <AccountSettings />}
        {section === 'people' && <PeopleManager />}
        {section === 'codex' && (
          <>
            <CodexSettings />
            <CatalogSettings />
          </>
        )}
        {section === 'simpleChat' && <SimpleChatSettings />}
        {section === 'terminal' && <TerminalSettings />}
        {section === 'files' && <FilesSettings />}
        {section === 'database' && <DatabaseSettings />}
        {section === 'security' && <SecuritySettings />}
        {section === 'integrations' && (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              {INTEGRATION_SECTIONS.map((item) => (
                <Button
                  key={item}
                  size="sm"
                  variant={integrationSection === item ? 'default' : 'outline'}
                  onClick={() => setIntegrationSection(item)}
                >
                  {t(
                    item === 'plugins'
                      ? 'Plugins'
                      : item === 'apps'
                        ? 'Apps'
                        : 'MCP Servers',
                  )}
                </Button>
              ))}
            </div>
            <Separator />
            {integrationSection === 'plugins' && <PluginsTab />}
            {integrationSection === 'apps' && <AppsTab />}
            {integrationSection === 'mcps' && <McpsTab />}
          </div>
        )}
      </div>
    </div>
  );
}
