import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ExternalLink,
  Loader2,
  MessageCircle,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { getAuthorizationHeader } from '@/auth-token';
import { withBasePath } from '@/base-path';
import { cn } from '@/lib/utils';

interface ChatSource {
  title: string;
  url: string;
}

interface ChatMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  sources: ChatSource[];
  totalTokens: number;
  createdAt: number;
}

interface ChatThread {
  id: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
}

interface ChatStatus {
  configured: boolean;
  model: string;
  webSearch: boolean;
}

interface ThreadDetail {
  thread: ChatThread;
  messages: ChatMessage[];
}

function apiHeaders() {
  const authorization = getAuthorizationHeader();
  return {
    'Content-Type': 'application/json',
    ...(authorization ? { Authorization: authorization } : {}),
  };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(withBasePath(`/api/simple-chat${path}`), {
    ...init,
    headers: { ...apiHeaders(), ...init?.headers },
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    message?: string;
  };
  if (!response.ok) {
    throw new Error(payload.message || `La requête a échoué (HTTP ${response.status}).`);
  }
  return payload;
}

export function SimpleChatRoute() {
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string>();
  const endRef = useRef<HTMLDivElement>(null);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId),
    [threads, activeThreadId],
  );

  useEffect(() => {
    Promise.all([
      api<ChatStatus>('/status'),
      api<{ models: string[] }>('/models'),
      api<{ threads: ChatThread[] }>('/threads'),
    ])
      .then(([nextStatus, modelResult, threadResult]) => {
        setStatus(nextStatus);
        setModels(modelResult.models);
        setThreads(threadResult.threads);
        setActiveThreadId(threadResult.threads[0]?.id);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : 'Chargement impossible.'),
      );
  }, []);

  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }
    setLoadingThread(true);
    api<ThreadDetail>(`/threads/${activeThreadId}`)
      .then((detail) => setMessages(detail.messages))
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : 'Conversation inaccessible.'),
      )
      .finally(() => setLoadingThread(false));
  }, [activeThreadId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const createThread = async () => {
    setError(undefined);
    try {
      const detail = await api<ThreadDetail>('/threads', {
        method: 'POST',
        body: JSON.stringify({ model: activeThread?.model || status?.model }),
      });
      setThreads((current) => [detail.thread, ...current]);
      setActiveThreadId(detail.thread.id);
      setMessages([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Création impossible.');
    }
  };

  const deleteThread = async (threadId: string) => {
    if (!window.confirm('Supprimer définitivement cette conversation ?')) return;
    try {
      await api(`/threads/${threadId}`, { method: 'DELETE' });
      const remaining = threads.filter((thread) => thread.id !== threadId);
      setThreads(remaining);
      if (activeThreadId === threadId) setActiveThreadId(remaining[0]?.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Suppression impossible.');
    }
  };

  const changeModel = async (model: string) => {
    if (!activeThreadId) return;
    try {
      const detail = await api<ThreadDetail>(`/threads/${activeThreadId}`, {
        method: 'PATCH',
        body: JSON.stringify({ model }),
      });
      setThreads((current) =>
        current.map((thread) => (thread.id === detail.thread.id ? detail.thread : thread)),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Changement de modèle impossible.');
    }
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = input.trim();
    if (!text || sending || !status?.configured) return;
    let threadId = activeThreadId;
    if (!threadId) {
      const created = await api<ThreadDetail>('/threads', {
        method: 'POST',
        body: JSON.stringify({ model: status.model }),
      });
      threadId = created.thread.id;
      setThreads((current) => [created.thread, ...current]);
      setActiveThreadId(threadId);
    }
    const temporary: ChatMessage = {
      id: crypto.randomUUID(),
      threadId,
      role: 'user',
      content: text,
      model: null,
      sources: [],
      totalTokens: 0,
      createdAt: Date.now(),
    };
    setMessages((current) => [...current, temporary]);
    setInput('');
    setSending(true);
    setError(undefined);
    try {
      const result = await api<{ message: ChatMessage; thread: ChatThread }>(
        `/threads/${threadId}/messages`,
        { method: 'POST', body: JSON.stringify({ message: text }) },
      );
      setMessages((current) => [...current, result.message]);
      setThreads((current) => [
        result.thread,
        ...current.filter((thread) => thread.id !== result.thread.id),
      ]);
    } catch (caught) {
      setMessages((current) => current.filter((message) => message.id !== temporary.id));
      setInput(text);
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
    <main className="flex min-h-0 flex-1">
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-muted/20 md:flex">
        <div className="p-3">
          <Button className="w-full justify-start" onClick={() => void createThread()}>
            <Plus className="h-4 w-4" /> Nouvelle conversation
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {threads.map((thread) => (
            <div
              key={thread.id}
              className={cn(
                'group mb-1 flex items-center rounded-lg',
                activeThreadId === thread.id ? 'bg-accent' : 'hover:bg-accent/50',
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 px-3 py-2 text-left"
                onClick={() => setActiveThreadId(thread.id)}
              >
                <p className="truncate text-sm">{thread.title}</p>
                <p className="truncate text-[11px] text-muted-foreground">{thread.model}</p>
              </button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="mr-1 h-7 w-7 opacity-0 group-hover:opacity-100"
                aria-label="Supprimer la conversation"
                onClick={() => void deleteThread(thread.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h1 className="text-base font-semibold">Chat simple</h1>
            <p className="text-xs text-muted-foreground">
              API OpenAI · recherche Web disponible · aucun accès au serveur
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={activeThreadId || ''}
              onChange={(event) => setActiveThreadId(event.target.value || undefined)}
              aria-label="Conversation"
              className="h-8 max-w-40 rounded-lg border border-input bg-background px-2 text-sm md:hidden"
            >
              <option value="">Nouvelle conversation</option>
              {threads.map((thread) => (
                <option key={thread.id} value={thread.id}>{thread.title}</option>
              ))}
            </select>
            <Button
              className="md:hidden"
              size="sm"
              variant="outline"
              onClick={() => void createThread()}
            >
              <Plus className="h-4 w-4" /> Nouveau
            </Button>
            <select
              value={activeThread?.model || status?.model || ''}
              onChange={(event) => void changeModel(event.target.value)}
              disabled={!activeThread || sending}
              aria-label="Modèle OpenAI"
              className="h-8 max-w-56 rounded-lg border border-input bg-background px-2 text-sm"
            >
              {models.map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {status && !status.configured && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
                La clé API OpenAI n’est pas encore configurée.
              </div>
            )}
            {!activeThreadId && !loadingThread && (
              <div className="py-16 text-center text-sm text-muted-foreground">
                <MessageCircle className="mx-auto mb-3 h-8 w-8" />
                Crée une conversation ou envoie directement un message.
              </div>
            )}
            {loadingThread && <Loader2 className="mx-auto mt-16 h-6 w-6 animate-spin" />}
            {messages.map((message) => (
              <article
                key={message.id}
                className={cn(
                  'max-w-[92%] rounded-2xl px-4 py-3 text-sm',
                  message.role === 'user'
                    ? 'ml-auto bg-primary text-primary-foreground'
                    : 'mr-auto border bg-card text-card-foreground',
                )}
              >
                {message.role === 'assistant' ? (
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{message.content}</p>
                )}
                {message.sources?.length > 0 && (
                  <div className="mt-3 border-t pt-2">
                    <p className="mb-1 text-[11px] font-medium opacity-70">Sources</p>
                    <div className="flex flex-wrap gap-1.5">
                      {message.sources.map((source) => (
                        <a
                          key={source.url}
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex max-w-64 items-center gap-1 truncate rounded border px-2 py-1 text-[11px] hover:bg-accent"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0" /> {source.title}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                {message.role === 'assistant' && (
                  <p className="mt-2 text-[11px] opacity-55">
                    {message.model} · {message.totalTokens} jetons
                  </p>
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
      </section>
    </main>
  );
}
