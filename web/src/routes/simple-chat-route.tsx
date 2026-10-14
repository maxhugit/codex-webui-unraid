import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Eraser, Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { getAuthorizationHeader } from '@/auth-token';
import { withBasePath } from '@/base-path';
import { cn } from '@/lib/utils';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tokens?: number;
}

interface ChatStatus {
  configured: boolean;
  model: string;
  maxOutputTokens: number;
}

interface ChatReply {
  responseId: string;
  text: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

const SESSION_KEY = 'codex.simple-chat.session';

function apiHeaders() {
  const authorization = getAuthorizationHeader();
  return {
    'Content-Type': 'application/json',
    ...(authorization ? { Authorization: authorization } : {}),
  };
}

export function SimpleChatRoute() {
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [previousResponseId, setPreviousResponseId] = useState<string>();
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}') as {
        messages?: ChatMessage[];
        previousResponseId?: string;
      };
      if (Array.isArray(saved.messages)) setMessages(saved.messages);
      if (typeof saved.previousResponseId === 'string') {
        setPreviousResponseId(saved.previousResponseId);
      }
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
    }

    fetch(withBasePath('/api/simple-chat/status'), { headers: apiHeaders() })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as ChatStatus;
      })
      .then(setStatus)
      .catch(() => setError('Impossible de lire la configuration du Chat simple.'));
  }, []);

  useEffect(() => {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ messages, previousResponseId }),
    );
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, previousResponseId]);

  const clearConversation = () => {
    setMessages([]);
    setPreviousResponseId(undefined);
    setError(undefined);
    sessionStorage.removeItem(SESSION_KEY);
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const message = input.trim();
    if (!message || sending || !status?.configured) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: message,
    };
    setMessages((current) => [...current, userMessage]);
    setInput('');
    setSending(true);
    setError(undefined);

    try {
      const response = await fetch(withBasePath('/api/simple-chat/responses'), {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ message, previousResponseId }),
      });
      const payload = (await response.json().catch(() => ({}))) as
        | ChatReply
        | { message?: string };
      if (!response.ok) {
        throw new Error('message' in payload && payload.message
          ? payload.message
          : `La requête a échoué (HTTP ${response.status}).`);
      }
      const reply = payload as ChatReply;
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: reply.text,
          tokens: reply.usage.totalTokens,
        },
      ]);
      setPreviousResponseId(reply.responseId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'La requête a échoué.');
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h1 className="text-base font-semibold">Chat simple</h1>
          <p className="text-xs text-muted-foreground">
            API OpenAI · {status?.model ?? 'chargement…'} · sans outils ni accès au serveur
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={clearConversation}>
          <Eraser className="h-4 w-4" />
          Nouveau chat
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {status && !status.configured && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
              La clé API OpenAI n’est pas encore installée sur Unraid.
            </div>
          )}
          {messages.length === 0 && (
            <div className="py-16 text-center text-sm text-muted-foreground">
              Pose une question courte. Ce mode limite les réponses à environ{' '}
              {status?.maxOutputTokens ?? 700} jetons et n’utilise aucun outil Codex.
            </div>
          )}
          {messages.map((message) => (
            <article
              key={message.id}
              className={cn(
                'max-w-[90%] rounded-2xl px-4 py-3 text-sm',
                message.role === 'user'
                  ? 'ml-auto bg-primary text-primary-foreground'
                  : 'mr-auto border bg-card text-card-foreground',
              )}
            >
              {message.role === 'assistant' ? (
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{message.text}</p>
              )}
              {message.tokens !== undefined && (
                <p className="mt-2 text-[11px] opacity-60">{message.tokens} jetons utilisés</p>
              )}
            </article>
          ))}
          {sending && (
            <div className="mr-auto flex items-center gap-2 rounded-2xl border bg-card px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Réponse en cours…
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div ref={endRef} />
        </div>
      </div>

      <form onSubmit={(event) => void send(event)} className="border-t bg-background p-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Écris ton message…"
            className="max-h-40 min-h-11 resize-none"
            maxLength={6_000}
            disabled={sending || status?.configured === false}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || sending || !status?.configured}
            aria-label="Envoyer"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </form>
    </main>
  );
}
