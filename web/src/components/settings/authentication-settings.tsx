import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { showSnackbar } from '@/stores/snackbar-store';
import { authRequest } from '@/lib/auth-api';
import { authenticationErrorMessage } from '@/lib/auth-error-message';
import { PeopleManager } from '@/components/projects/people-manager';

interface AuthenticationConfiguration {
  version: 1;
  path: string;
  local: {
    enabled: boolean;
    sessionTtlHours: number;
    maxFailedAttempts: number;
    lockoutMinutes: number;
  };
  oidc: {
    enabled: boolean;
    issuerUrl: string;
    clientId: string;
    redirectUri: string;
    scopes: string;
    autoRedirect: boolean;
    clientSecretConfigured: boolean;
  };
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type="number"
        min={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function AuthenticationSettings() {
  const { t } = useTranslation('authentication');
  const [configuration, setConfiguration] =
    useState<AuthenticationConfiguration | null>(null);
  const [saving, setSaving] = useState(false);
  const [oidcClientSecret, setOidcClientSecret] = useState('');

  const load = useCallback(async () => {
    const nextConfiguration =
      await authRequest<AuthenticationConfiguration>('configuration');
    setConfiguration(nextConfiguration);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((error: unknown) =>
        showSnackbar(
          authenticationErrorMessage(error, t, 'settings.loadError'),
          'error',
        ),
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, t]);

  const saveConfiguration = async () => {
    if (!configuration) return;
    setSaving(true);
    try {
      const updated = await authRequest<AuthenticationConfiguration>(
        'configuration',
        {
          method: 'PATCH',
          body: JSON.stringify({
            ...configuration,
            oidc: {
              ...configuration.oidc,
              ...(oidcClientSecret ? { clientSecret: oidcClientSecret } : {}),
            },
          }),
        },
      );
      setConfiguration(updated);
      setOidcClientSecret('');
      showSnackbar(t('settings.saved'), 'success');
    } catch (error) {
      showSnackbar(
        authenticationErrorMessage(error, t, 'settings.saveError'),
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  if (!configuration)
    return (
      <p className="text-sm text-muted-foreground">{t('settings.loading')}</p>
    );

  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-muted-foreground">
          {t('settings.title')}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t('settings.description')}
        </p>
        <code className="block break-all text-xs text-muted-foreground">
          {configuration.path}
        </code>
      </div>

      <div className="space-y-4 rounded-xl border bg-card/50 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-medium">{t('settings.local.title')}</h3>
            <p className="text-xs text-muted-foreground">
              {t('settings.local.description')}
            </p>
          </div>
          <Switch
            checked={configuration.local.enabled}
            disabled={saving}
            onCheckedChange={(enabled) =>
              setConfiguration({
                ...configuration,
                local: { ...configuration.local, enabled },
              })
            }
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label={t('settings.local.sessionLifetimeHours')}
            value={configuration.local.sessionTtlHours}
            onChange={(sessionTtlHours) =>
              setConfiguration({
                ...configuration,
                local: { ...configuration.local, sessionTtlHours },
              })
            }
          />
          <NumberField
            label={t('settings.local.failedAttempts')}
            value={configuration.local.maxFailedAttempts}
            onChange={(maxFailedAttempts) =>
              setConfiguration({
                ...configuration,
                local: { ...configuration.local, maxFailedAttempts },
              })
            }
          />
          <NumberField
            label={t('settings.local.lockoutMinutes')}
            value={configuration.local.lockoutMinutes}
            onChange={(lockoutMinutes) =>
              setConfiguration({
                ...configuration,
                local: { ...configuration.local, lockoutMinutes },
              })
            }
          />
        </div>
        <Button onClick={() => void saveConfiguration()} disabled={saving}>
          {t('settings.local.save')}
        </Button>
      </div>

      <div className="space-y-3 rounded-xl border bg-card/50 p-4">
        <div>
          <h3 className="font-medium">{t('settings.accounts.title')}</h3>
          <p className="text-xs text-muted-foreground">
            {t('settings.accounts.description')}
          </p>
        </div>
        <PeopleManager mode="activeAdministrators" showHeading={false} />
      </div>

      <div className="space-y-3 rounded-xl border bg-card/50 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-medium">{t('settings.oidc.title')}</h3>
            <p className="text-xs text-muted-foreground">
              {t('settings.oidc.description')}
            </p>
          </div>
          <Switch
            checked={configuration.oidc.enabled}
            disabled={saving}
            onCheckedChange={(enabled) =>
              setConfiguration({
                ...configuration,
                oidc: { ...configuration.oidc, enabled },
              })
            }
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            value={configuration.oidc.issuerUrl}
            placeholder={t('settings.oidc.issuerUrl')}
            onChange={(event) =>
              setConfiguration({
                ...configuration,
                oidc: {
                  ...configuration.oidc,
                  issuerUrl: event.target.value,
                },
              })
            }
          />
          <Input
            value={configuration.oidc.clientId}
            placeholder={t('settings.oidc.clientId')}
            onChange={(event) =>
              setConfiguration({
                ...configuration,
                oidc: {
                  ...configuration.oidc,
                  clientId: event.target.value,
                },
              })
            }
          />
          <Input
            type="password"
            value={oidcClientSecret}
            placeholder={
              configuration.oidc.clientSecretConfigured
                ? t('settings.oidc.configuredClientSecret')
                : t('settings.oidc.clientSecret')
            }
            autoComplete="new-password"
            onChange={(event) => setOidcClientSecret(event.target.value)}
          />
          <Input
            value={configuration.oidc.redirectUri}
            placeholder="https://codex.example/api/auth/oidc/callback"
            onChange={(event) =>
              setConfiguration({
                ...configuration,
                oidc: {
                  ...configuration.oidc,
                  redirectUri: event.target.value,
                },
              })
            }
          />
          <Input
            value={configuration.oidc.scopes}
            placeholder={t('settings.oidc.scopes')}
            onChange={(event) =>
              setConfiguration({
                ...configuration,
                oidc: {
                  ...configuration.oidc,
                  scopes: event.target.value,
                },
              })
            }
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {t('settings.oidc.redirectHelp')}
        </p>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>{t('settings.oidc.autoRedirect')}</span>
          <Switch
            checked={configuration.oidc.autoRedirect}
            disabled={saving}
            onCheckedChange={(autoRedirect) =>
              setConfiguration({
                ...configuration,
                oidc: { ...configuration.oidc, autoRedirect },
              })
            }
          />
        </label>
        <Button
          variant="outline"
          onClick={() => void saveConfiguration()}
          disabled={saving}
        >
          {t('settings.oidc.save')}
        </Button>
      </div>
    </section>
  );
}
