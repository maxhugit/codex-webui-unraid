import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getAuthorizationHeader } from '@/auth-token';
import { withBasePath } from '@/base-path';

interface KeyStatus {
  configured: boolean;
  managed: boolean;
}

function headers() {
  const authorization = getAuthorizationHeader();
  return {
    'Content-Type': 'application/json',
    ...(authorization ? { Authorization: authorization } : {}),
  };
}

export function SimpleChatSettings() {
  const [status, setStatus] = useState<KeyStatus>();
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    fetch(withBasePath('/api/simple-chat/api-key'), { headers: headers() })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as KeyStatus;
      })
      .then(setStatus)
      .catch(() => setError('Impossible de lire l’état de la clé API.'));
  }, []);

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
      if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
      setStatus(payload);
      setApiKey('');
      setMessage('La clé API a été enregistrée et activée.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Enregistrement impossible.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Chat simple</h2>
        <p className="text-sm text-muted-foreground">
          Configure la clé utilisée par le chat API séparé de Codex.
        </p>
      </div>

      <div className="rounded-xl border p-4">
        <div className="mb-4 flex items-center gap-2 text-sm">
          {status?.configured ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Clé API configurée{status.managed ? ' depuis cette interface' : ' sur Unraid'}
            </>
          ) : (
            <>
              <KeyRound className="h-4 w-4 text-amber-500" />
              Aucune clé API disponible
            </>
          )}
        </div>

        <label htmlFor="openai-api-key" className="mb-1.5 block text-sm font-medium">
          Nouvelle clé API OpenAI
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
          <Button disabled={!apiKey.trim() || saving} onClick={() => void save()}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Enregistrer
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          La clé est envoyée par HTTPS, stockée uniquement sur le serveur avec des
          permissions restrictives et ne peut jamais être relue depuis l’interface.
        </p>
        {message && <p className="mt-3 text-sm text-emerald-600">{message}</p>}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </div>
    </section>
  );
}
