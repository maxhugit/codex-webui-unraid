/** Login page for local credentials and emergency API-key access. */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KeyRound, Loader2, UserRound } from 'lucide-react';

interface Props {
  localEnabled: boolean;
  onLocalLogin: (username: string, password: string) => Promise<boolean>;
  onApiKeyLogin: (apiKey: string) => Promise<boolean>;
}

export function LoginPage({
  localEnabled,
  onLocalLogin,
  onApiKeyLogin,
}: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'local' | 'apiKey'>(
    localEnabled ? 'local' : 'apiKey',
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mode === 'local' && (!username.trim() || !password)) return;
    if (mode === 'apiKey' && !apiKey.trim()) return;

    setLoading(true);
    setError('');
    try {
      const ok =
        mode === 'local'
          ? await onLocalLogin(username.trim(), password)
          : await onApiKeyLogin(apiKey.trim());
      if (!ok)
        setError(
          t(
            mode === 'local'
              ? 'Invalid username or password'
              : 'Invalid API key',
          ),
        );
    } catch {
      setError(t('Failed to connect to server'));
    } finally {
      setLoading(false);
    }
  };

  const disabled =
    loading ||
    (mode === 'local' ? !username.trim() || !password : !apiKey.trim());

  return (
    <div className="relative flex h-[var(--app-vh,100dvh)] items-center justify-center overflow-hidden bg-background p-4">
      <form
        onSubmit={handleSubmit}
        className="glass-5 relative z-10 w-full max-w-sm space-y-5 rounded-3xl p-8"
      >
        <div className="flex items-center gap-2.5 text-lg font-semibold">
          {mode === 'local' ? (
            <UserRound className="h-5 w-5 opacity-70" />
          ) : (
            <KeyRound className="h-5 w-5 opacity-70" />
          )}
          Codex WebUI
        </div>

        {localEnabled && (
          <div className="grid grid-cols-2 rounded-xl border p-1">
            <Button
              type="button"
              size="sm"
              variant={mode === 'local' ? 'default' : 'ghost'}
              onClick={() => {
                setMode('local');
                setError('');
              }}
            >
              {t('Local account')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === 'apiKey' ? 'default' : 'ghost'}
              onClick={() => {
                setMode('apiKey');
                setError('');
              }}
            >
              {t('API key')}
            </Button>
          </div>
        )}

        {mode === 'local' ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('Sign in with your local account.')}
            </p>
            <Input
              value={username}
              placeholder={t('Username')}
              autoComplete="username"
              autoFocus
              onChange={(event) => setUsername(event.target.value)}
            />
            <Input
              type="password"
              value={password}
              placeholder={t('Password')}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {t('Enter your API key to continue.')}
            </p>
            <Input
              type="password"
              placeholder={t('API Key')}
              value={apiKey}
              autoComplete="off"
              autoFocus={!localEnabled}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </div>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}

        <Button type="submit" className="w-full rounded-xl" disabled={disabled}>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('Login')}
        </Button>
      </form>
    </div>
  );
}
