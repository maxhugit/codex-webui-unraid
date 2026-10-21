/** Login route component for local sessions and API-key fallback. */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { LoginPage } from '@/components/login';
import { SnackbarContainer } from '@/components/snackbar/snackbar-container';
import { authLogin, filesGetRoots } from '@/generated/api';
import { setApiToken, clearApiToken } from '@/auth-token';
import { resetSocket } from '@/socket';
import { withBasePath } from '@/base-path';
import { useTranslation } from 'react-i18next';

interface AuthMethods {
  localEnabled: boolean;
  oidcEnabled: boolean;
  oidcAutoRedirect: boolean;
  apiKeyEnabled: boolean;
}

export function LoginRoute() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { redirect, manual } = useSearch({ from: '/login' });
  const [methods, setMethods] = useState<AuthMethods | null>(null);

  useEffect(() => {
    fetch(withBasePath('/api/auth/methods'), { credentials: 'same-origin' })
      .then(async (response) => {
        if (response.ok) {
          const next = (await response.json()) as AuthMethods;
          setMethods(next);
          if (next.oidcEnabled && next.oidcAutoRedirect && !manual)
            window.location.assign(
              withBasePath(
                `/api/auth/oidc/start?returnTo=${encodeURIComponent(redirect)}`,
              ),
            );
        }
      })
      .catch(() =>
        setMethods({
          localEnabled: false,
          oidcEnabled: false,
          oidcAutoRedirect: false,
          apiKeyEnabled: true,
        }),
      );
  }, [manual, redirect]);

  const handleOidcLogin = useCallback(() => {
    clearApiToken();
    window.location.assign(
      withBasePath(
        `/api/auth/oidc/start?returnTo=${encodeURIComponent(redirect)}`,
      ),
    );
  }, [redirect]);

  const completeLogin = useCallback(async (): Promise<boolean> => {
    try {
      await filesGetRoots({ throwOnError: true });
      resetSocket();
      void navigate({ to: redirect });
      return true;
    } catch {
      return false;
    }
  }, [navigate, redirect]);

  const handleApiKeyLogin = useCallback(
    async (apiKey: string): Promise<boolean> => {
      try {
        const { data: loginData } = await authLogin({
          body: { apiKey },
          throwOnError: true,
        });
        setApiToken(loginData.accessToken);
        const ok = await completeLogin();
        if (!ok) clearApiToken();
        return ok;
      } catch {
        clearApiToken();
        return false;
      }
    },
    [completeLogin],
  );

  const handleLocalLogin = useCallback(
    async (username: string, password: string): Promise<boolean> => {
      try {
        clearApiToken();
        const response = await fetch(withBasePath('/api/auth/local-login'), {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        if (!response.ok) return false;
        return completeLogin();
      } catch {
        return false;
      }
    },
    [completeLogin],
  );

  return (
    <>
      {methods ? (
        <LoginPage
          localEnabled={methods.localEnabled}
          oidcEnabled={methods.oidcEnabled}
          onOidcLogin={handleOidcLogin}
          onLocalLogin={handleLocalLogin}
          onApiKeyLogin={handleApiKeyLogin}
        />
      ) : (
        <div className="flex h-[var(--app-vh,100dvh)] items-center justify-center bg-background text-sm text-muted-foreground">
          {t('Loading…')}
        </div>
      )}
      <SnackbarContainer />
    </>
  );
}
