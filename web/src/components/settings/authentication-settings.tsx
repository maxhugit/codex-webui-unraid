import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { getAuthorizationHeader } from '@/auth-token';
import { withBasePath } from '@/base-path';
import { showSnackbar } from '@/stores/snackbar-store';

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

interface LocalAccount {
  personId: string;
  name: string;
  email: string | null;
  active: boolean;
  role: 'standard' | 'administrator';
  username: string | null;
  passwordConfigured: boolean;
  oidcLinked: boolean;
  lockedUntil: number | null;
  lastLoginAt: number | null;
}

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const authorization = getAuthorizationHeader();
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set('Content-Type', 'application/json');
  if (authorization) headers.set('Authorization', authorization);
  const response = await fetch(withBasePath(`/api/auth/${path}`), {
    credentials: 'same-origin',
    ...init,
    headers,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(payload?.message || 'Authentication request failed');
  }
  return response.status === 204 ? (undefined as T) : response.json();
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
  const { t } = useTranslation();
  const [configuration, setConfiguration] =
    useState<AuthenticationConfiguration | null>(null);
  const [accounts, setAccounts] = useState<LocalAccount[]>([]);
  const [drafts, setDrafts] = useState<
    Record<string, { username: string; password: string }>
  >({});
  const [saving, setSaving] = useState(false);
  const [oidcClientSecret, setOidcClientSecret] = useState('');

  const load = useCallback(async () => {
    const [nextConfiguration, accountResponse] = await Promise.all([
      authRequest<AuthenticationConfiguration>('configuration'),
      authRequest<{ accounts: LocalAccount[] }>('local-accounts'),
    ]);
    setConfiguration(nextConfiguration);
    setAccounts(accountResponse.accounts);
    setDrafts(
      Object.fromEntries(
        accountResponse.accounts.map((account) => [
          account.personId,
          { username: account.username ?? '', password: '' },
        ]),
      ),
    );
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((error: unknown) =>
        showSnackbar(
          error instanceof Error
            ? t(error.message)
            : t('Unable to load authentication settings'),
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
      showSnackbar(t('Authentication settings saved'), 'success');
    } catch (error) {
      showSnackbar(
        error instanceof Error
          ? t(error.message)
          : t('Unable to save authentication settings'),
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  const saveAccount = async (account: LocalAccount) => {
    const draft = drafts[account.personId];
    if (!draft) return;
    setSaving(true);
    try {
      await authRequest(
        `local-accounts/${encodeURIComponent(account.personId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            username: draft.username,
            ...(draft.password ? { password: draft.password } : {}),
          }),
        },
      );
      await load();
      showSnackbar(t('Local account saved'), 'success');
    } catch (error) {
      showSnackbar(
        error instanceof Error
          ? t(error.message)
          : t('Unable to save local account'),
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  const removeAccount = async (account: LocalAccount) => {
    setSaving(true);
    try {
      await authRequest(
        `local-accounts/${encodeURIComponent(account.personId)}`,
        {
          method: 'DELETE',
        },
      );
      await load();
      showSnackbar(t('Local account removed'), 'success');
    } catch (error) {
      showSnackbar(
        error instanceof Error
          ? t(error.message)
          : t('Unable to remove local account'),
        'error',
      );
    } finally {
      setSaving(false);
    }
  };

  if (!configuration)
    return <p className="text-sm text-muted-foreground">{t('Loading...')}</p>;

  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-muted-foreground">
          {t('Authentication')}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t('Authentication settings are persisted in AppData.')}
        </p>
        <code className="block break-all text-xs text-muted-foreground">
          {configuration.path}
        </code>
      </div>

      <div className="space-y-4 rounded-xl border bg-card/50 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-medium">{t('Local account and password')}</h3>
            <p className="text-xs text-muted-foreground">
              {t(
                'Enable local login after configuring at least one active account.',
              )}
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
            label={t('Session lifetime in hours')}
            value={configuration.local.sessionTtlHours}
            onChange={(sessionTtlHours) =>
              setConfiguration({
                ...configuration,
                local: { ...configuration.local, sessionTtlHours },
              })
            }
          />
          <NumberField
            label={t('Failed attempts before lockout')}
            value={configuration.local.maxFailedAttempts}
            onChange={(maxFailedAttempts) =>
              setConfiguration({
                ...configuration,
                local: { ...configuration.local, maxFailedAttempts },
              })
            }
          />
          <NumberField
            label={t('Lockout duration in minutes')}
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
          {t('Save authentication settings')}
        </Button>
      </div>

      <div className="space-y-3 rounded-xl border bg-card/50 p-4">
        <div>
          <h3 className="font-medium">{t('Local accounts')}</h3>
          <p className="text-xs text-muted-foreground">
            {t(
              'Passwords are hashed with Argon2id and never stored in the configuration file.',
            )}
          </p>
        </div>
        {accounts.map((account) => {
          const draft = drafts[account.personId] ?? {
            username: '',
            password: '',
          };
          return (
            <div
              key={account.personId}
              className="space-y-3 rounded-lg border p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{account.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {account.email} ·{' '}
                    {t(
                      account.role === 'administrator'
                        ? 'Administrator'
                        : 'Standard user',
                    )}
                    {!account.active ? ` · ${t('Inactive')}` : ''}
                  </div>
                </div>
                {account.passwordConfigured && (
                  <span className="rounded-full border px-2 py-1 text-xs">
                    {t('Password configured')}
                  </span>
                )}
                {account.oidcLinked && (
                  <span className="rounded-full border px-2 py-1 text-xs">
                    {t('SSO identity linked')}
                  </span>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  value={draft.username}
                  placeholder={t('Username')}
                  autoComplete="off"
                  onChange={(event) =>
                    setDrafts({
                      ...drafts,
                      [account.personId]: {
                        ...draft,
                        username: event.target.value,
                      },
                    })
                  }
                />
                <Input
                  type="password"
                  value={draft.password}
                  placeholder={
                    account.passwordConfigured
                      ? t('New password (leave empty to keep it)')
                      : t('Password (12 characters minimum)')
                  }
                  autoComplete="new-password"
                  onChange={(event) =>
                    setDrafts({
                      ...drafts,
                      [account.personId]: {
                        ...draft,
                        password: event.target.value,
                      },
                    })
                  }
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={saving}
                  onClick={() => void saveAccount(account)}
                >
                  {t('Configure local account')}
                </Button>
                {account.passwordConfigured && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving}
                    onClick={() => void removeAccount(account)}
                  >
                    {t('Remove local login')}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-3 rounded-xl border bg-card/50 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="font-medium">{t('Single sign-on (OIDC)')}</h3>
            <p className="text-xs text-muted-foreground">
              {t(
                'The provider connection is verified before OIDC is enabled.',
              )}
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
            placeholder={t('Issuer URL')}
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
            placeholder={t('Client ID')}
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
                ? t('Client secret configured (leave empty to keep it)')
                : t('Client secret')
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
            placeholder={t('Scopes')}
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
          {t(
            'Register the redirect URI exactly in the Authentik OAuth2/OpenID provider.',
          )}
        </p>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>{t('Redirect automatically when OIDC is enabled')}</span>
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
          {t('Save and verify OIDC')}
        </Button>
      </div>
    </section>
  );
}
