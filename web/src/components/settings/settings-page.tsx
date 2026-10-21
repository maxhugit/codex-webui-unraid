/**
 * Settings page shell with tab routing to category sub-components.
 */
import { lazy, Suspense, useState } from 'react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { clearApiToken } from '@/auth-token';
import { authLogout } from '@/generated/api';
import { resetSocket } from '@/socket';
import type { SettingsSection } from './settings-sections';
import { cn } from '@/lib/utils';

const INTEGRATION_SECTIONS = ['plugins', 'apps', 'mcps'] as const;
type IntegrationSection = (typeof INTEGRATION_SECTIONS)[number];

const GeneralSettings = lazy(() =>
  import('./general-settings').then((module) => ({
    default: module.GeneralSettings,
  })),
);
const AccountSettings = lazy(() =>
  import('./account/account-settings').then((module) => ({
    default: module.AccountSettings,
  })),
);
const CodexSettings = lazy(() =>
  import('./codex-settings').then((module) => ({
    default: module.CodexSettings,
  })),
);
const CodexCliSettings = lazy(() =>
  import('./codex-cli-settings').then((module) => ({
    default: module.CodexCliSettings,
  })),
);
const TerminalSettings = lazy(() =>
  import('./terminal-settings').then((module) => ({
    default: module.TerminalSettings,
  })),
);
const FilesSettings = lazy(() =>
  import('./files-settings').then((module) => ({
    default: module.FilesSettings,
  })),
);
const SecuritySettings = lazy(() =>
  import('./security-settings').then((module) => ({
    default: module.SecuritySettings,
  })),
);
const SimpleChatSettings = lazy(() =>
  import('./simple-chat-settings').then((module) => ({
    default: module.SimpleChatSettings,
  })),
);
const PluginsTab = lazy(() =>
  import('@/components/integrations/plugins-tab').then((module) => ({
    default: module.PluginsTab,
  })),
);
const AppsTab = lazy(() =>
  import('@/components/integrations/apps-tab').then((module) => ({
    default: module.AppsTab,
  })),
);
const McpsTab = lazy(() =>
  import('@/components/integrations/mcps-tab').then((module) => ({
    default: module.McpsTab,
  })),
);
const PeopleManager = lazy(() =>
  import('@/components/projects/people-manager').then((module) => ({
    default: module.PeopleManager,
  })),
);
const DatabaseSettings = lazy(() =>
  import('./database-settings').then((module) => ({
    default: module.DatabaseSettings,
  })),
);

export function SettingsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const section = useRouterState({
    select: (s) =>
      (s.location.search as { section?: SettingsSection }).section ?? 'general',
  });
  const [integrationSection, setIntegrationSection] =
    useState<IntegrationSection>('plugins');

  const handleLogout = async () => {
    await authLogout({ throwOnError: false }).catch(() => undefined);
    clearApiToken();
    resetSocket();
    void navigate({ to: '/login', search: { redirect: '/', manual: true } });
  };

  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 flex-col',
        section === 'database' ? 'overflow-hidden' : 'overflow-auto',
      )}
    >
      <div
        className={cn(
          'mx-auto w-full',
          section === 'database'
            ? 'flex min-h-0 flex-1 flex-col'
            : 'max-w-4xl space-y-6 px-4 py-4 sm:px-6',
        )}
      >
        <Suspense
          fallback={
            <div className="p-6 text-sm text-muted-foreground" role="status">
              {t('Loading…')}
            </div>
          }
        >
          {section === 'general' && <GeneralSettings onLogout={handleLogout} />}
          {section === 'account' && <AccountSettings />}
          {section === 'people' && <PeopleManager showHeading={false} />}
          {section === 'codex' && <CodexSettings />}
          {section === 'codexCli' && <CodexCliSettings />}
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
                    variant={
                      integrationSection === item ? 'default' : 'outline'
                    }
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
        </Suspense>
      </div>
    </div>
  );
}
