import { useEffect, useState } from 'react';
import { Bot, CheckCircle2, KeyRound, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getAuthorizationHeader } from '@/auth-token';
import { withBasePath } from '@/base-path';
import { useTranslation } from 'react-i18next';

interface KeyStatus {
  configured: boolean;
  managed: boolean;
}

interface BackendStatus {
  backend: 'openai' | 'codex';
  configured: boolean;
}

function headers() {
  const authorization = getAuthorizationHeader();
  return {
    'Content-Type': 'application/json',
    ...(authorization ? { Authorization: authorization } : {}),
  };
}

export function SimpleChatSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<KeyStatus>();
  const [backend, setBackend] = useState<'openai' | 'codex'>('openai');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    Promise.all([
      fetch(withBasePath('/api/simple-chat/api-key'), { headers: headers() }),
      fetch(withBasePath('/api/simple-chat/settings'), { headers: headers() }),
    ])
      .then(async ([keyResponse, backendResponse]) => {
        if (!keyResponse.ok || !backendResponse.ok)
          throw new Error(
            `HTTP ${keyResponse.status || backendResponse.status}`,
          );
        const key = (await keyResponse.json()) as KeyStatus;
        const engine = (await backendResponse.json()) as BackendStatus;
        return { key, engine };
      })
      .then(({ key, engine }) => {
        setStatus(key);
        setBackend(engine.backend);
      })
      .catch(() => setError(t('Unable to read the Simple Chat settings.')));
  }, [t]);

  const saveBackend = async (value: 'openai' | 'codex') => {
    setSaving(true);
    setMessage(undefined);
    setError(undefined);
    try {
      const response = await fetch(withBasePath('/api/simple-chat/settings'), {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ backend: value }),
      });
      const payload = (await response.json().catch(() => ({}))) as
        | BackendStatus
        | { message?: string };
      if (!response.ok)
        throw new Error(
          'message' in payload ? payload.message : `HTTP ${response.status}`,
        );
      setBackend(value);
      setMessage(
        value === 'codex'
          ? t('Simple Chat now uses Codex CLI.')
          : t('Simple Chat now uses the OpenAI API.'),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('Unable to save.'));
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setMessage(undefined);
    setError(undefined);
    try {
      const response = await fetch(withBasePath('/api/simple-chat/api-key'), {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as KeyStatus & {
        message?: string;
      };
      if (!response.ok)
        throw new Error(payload.message || `HTTP ${response.status}`);
      setStatus(payload);
      setApiKey('');
      setMessage(t('The API key has been saved and activated.'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('Unable to save.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">{t('Simple Chat')}</h2>
        <p className="text-sm text-muted-foreground">
          {t('Choose the execution engine used by Simple Chat conversations.')}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          className={`cursor-pointer rounded-xl border p-4 text-left transition-colors hover:bg-accent/40 ${backend === 'openai' ? 'border-primary bg-primary/5' : ''}`}
          disabled={saving}
          onClick={() => void saveBackend('openai')}
        >
          <div className="flex items-center gap-2 font-medium">
            <KeyRound className="h-4 w-4" /> {t('OpenAI API')}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t(
              'Uses the API key saved below and the model selected for each conversation.',
            )}
          </p>
        </button>
        <button
          type="button"
          className={`cursor-pointer rounded-xl border p-4 text-left transition-colors hover:bg-accent/40 ${backend === 'codex' ? 'border-primary bg-primary/5' : ''}`}
          disabled={saving}
          onClick={() => void saveBackend('codex')}
        >
          <div className="flex items-center gap-2 font-medium">
            <Bot className="h-4 w-4" /> {t('Codex CLI')}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t(
              'Uses the Codex subscription with the model and reasoning effort configured for the project.',
            )}
          </p>
        </button>
      </div>

      {backend === 'openai' && (
        <div className="rounded-xl border p-4">
          <div className="mb-4 flex items-center gap-2 text-sm">
            {status?.configured ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                {t('API key configured')}
                {status.managed ? t(' from this interface') : t(' on Unraid')}
              </>
            ) : (
              <>
                <KeyRound className="h-4 w-4 text-amber-500" />
                {t('No API key available')}
              </>
            )}
          </div>

          <label
            htmlFor="openai-api-key"
            className="mb-1.5 block text-sm font-medium"
          >
            {t('New OpenAI API key')}
          </label>
          <div className="flex gap-2">
            <Input
              id="openai-api-key"
              type="password"
              value={apiKey}
              autoComplete="new-password"
              placeholder="sk-proj-…"
              onChange={(event) => setApiKey(event.target.value)}
            />
            <Button
              disabled={!apiKey.trim() || saving}
              onClick={() => void save()}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('Save')}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t(
              'The key is sent over HTTPS, stored only on the server with restrictive permissions, and can never be read back from the interface.',
            )}
          </p>
          {message && (
            <p className="mt-3 text-sm text-emerald-600">{message}</p>
          )}
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </div>
      )}
    </section>
  );
}
