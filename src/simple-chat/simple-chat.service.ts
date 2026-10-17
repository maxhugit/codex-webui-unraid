import { Inject, Injectable } from '@nestjs/common';
import { asc, desc, eq } from 'drizzle-orm';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-codes';
import { DRIZZLE_DB, type AppDatabase } from '../database/database.constants';
import { simpleChatMessages, simpleChatThreads } from '../database/schema';
import { FilesService } from '../files/files.service';

const DEFAULT_MODEL = 'gpt-5-mini';
const MAX_MESSAGE_LENGTH = 6_000;
const MAX_CONTEXT_MESSAGES = 30;
const REQUEST_TIMEOUT_MS = 120_000;
const MODEL_CACHE_MS = 10 * 60_000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';

interface OpenAiUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

interface OpenAiAnnotation {
  type?: string;
  url?: string;
  title?: string;
  url_citation?: { url?: string; title?: string };
}

interface OpenAiResponse {
  id?: string;
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string };
  output?: Array<{
    type?: string;
    action?: {
      sources?: Array<{ url?: string; title?: string }>;
    };
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: OpenAiAnnotation[];
    }>;
  }>;
  usage?: OpenAiUsage;
}

interface OpenAiModelList {
  data?: Array<{ id?: string }>;
}

export interface SimpleChatSource {
  title: string;
  url: string;
}

@Injectable()
export class SimpleChatService {
  readonly maxAudioBytes = MAX_AUDIO_BYTES;
  private readonly defaultModel =
    process.env.OPENAI_CHAT_MODEL?.trim() || DEFAULT_MODEL;
  private readonly externalKeyFile = process.env.OPENAI_API_KEY_FILE?.trim();
  private readonly managedKeyFile =
    process.env.OPENAI_API_KEY_MANAGED_FILE?.trim() ||
    join(
      process.env.CODEX_HOME?.trim() || '/home/codex/.codex',
      'secrets',
      'openai-api-key',
    );
  private modelCache?: { expiresAt: number; models: string[] };

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: AppDatabase,
    private readonly filesService: FilesService,
  ) {}

  getStatus() {
    return {
      configured: this.hasApiKey(),
      model: this.defaultModel,
      webSearch: true,
    };
  }

  getKeyStatus() {
    return {
      configured: this.hasApiKey(),
      managed: Boolean(this.readKeyFile(this.managedKeyFile)),
    };
  }

  saveApiKey(value: unknown) {
    const key = typeof value === 'string' ? value.trim() : '';
    if (!key || key.length < 20 || /\s/.test(key)) {
      throw BusinessException.badRequest(
        ErrorCode.simpleChat.apiKeyInvalid,
        'The OpenAI API key is invalid',
      );
    }
    mkdirSync(dirname(this.managedKeyFile), { recursive: true, mode: 0o700 });
    const temporaryFile = `${this.managedKeyFile}.${process.pid}.tmp`;
    writeFileSync(temporaryFile, key, { encoding: 'utf8', mode: 0o600 });
    chmodSync(temporaryFile, 0o600);
    renameSync(temporaryFile, this.managedKeyFile);
    return this.getKeyStatus();
  }

  async transcribeAudio(input: {
    bytes: Buffer;
    filename: string;
    mimeType?: string;
  }): Promise<{ text: string }> {
    if (!input.bytes.length) {
      throw BusinessException.badRequest(
        ErrorCode.simpleChat.audioRequired,
        'Voice recording is empty',
      );
    }
    if (input.bytes.length > MAX_AUDIO_BYTES) {
      throw BusinessException.payloadTooLarge(
        ErrorCode.simpleChat.audioTooLarge,
        'Voice recording is too large',
      );
    }
    const mimeType = input.mimeType?.split(';', 1)[0] || 'audio/webm';
    if (
      !/^(audio\/(webm|mp4|mpeg|mp3|wav|ogg|m4a|x-m4a)|video\/(webm|mp4))$/i.test(
        mimeType,
      )
    ) {
      throw BusinessException.badRequest(
        ErrorCode.simpleChat.audioInvalid,
        'Unsupported audio format',
      );
    }
    const form = new FormData();
    form.append('model', TRANSCRIPTION_MODEL);
    form.append('language', 'fr');
    form.append(
      'file',
      new Blob([new Uint8Array(input.bytes)], { type: mimeType }),
      input.filename || 'dictation.webm',
    );
    const response = await this.openAiRequest('/v1/audio/transcriptions', {
      method: 'POST',
      body: form,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      text?: string;
      error?: { message?: string };
    };
    if (!response.ok) {
      throw BusinessException.internal(
        ErrorCode.simpleChat.upstreamFailed,
        payload.error?.message || `OpenAI API returned HTTP ${response.status}`,
      );
    }
    const text = payload.text?.trim();
    if (!text) {
      throw BusinessException.internal(
        ErrorCode.simpleChat.invalidResponse,
        'OpenAI returned an empty transcription',
      );
    }
    return { text };
  }

  async listModels(): Promise<{ models: string[]; defaultModel: string }> {
    if (this.modelCache && this.modelCache.expiresAt > Date.now()) {
      return {
        models: this.modelCache.models,
        defaultModel: this.defaultModel,
      };
    }
    const response = await this.openAiRequest('/v1/models', { method: 'GET' });
    const payload = (await response
      .json()
      .catch(() => ({}))) as OpenAiModelList;
    if (!response.ok) {
      throw BusinessException.internal(
        ErrorCode.simpleChat.upstreamFailed,
        `Unable to list OpenAI models (HTTP ${response.status})`,
      );
    }
    const models = [
      ...new Set(
        (payload.data ?? [])
          .map((item) => item.id)
          .filter((id): id is string => Boolean(id) && this.isChatModel(id!)),
      ),
    ].sort(
      (a, b) => this.modelRank(a) - this.modelRank(b) || a.localeCompare(b),
    );
    if (!models.includes(this.defaultModel)) models.unshift(this.defaultModel);
    this.modelCache = { expiresAt: Date.now() + MODEL_CACHE_MS, models };
    return { models, defaultModel: this.defaultModel };
  }

  listThreads() {
    return {
      threads: this.db
        .select()
        .from(simpleChatThreads)
        .orderBy(desc(simpleChatThreads.updatedAt))
        .all(),
    };
  }

  async createThread(input: { model?: unknown; cwd?: unknown }) {
    const cwd = await this.resolveWorkspace(input.cwd);
    const now = Date.now();
    const thread = {
      id: randomUUID(),
      title: 'Nouvelle conversation',
      model: this.parseModel(input.model) || this.defaultModel,
      cwd,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(simpleChatThreads).values(thread).run();
    return { thread, messages: [] };
  }

  readThread(threadId: string) {
    const thread = this.requireThread(threadId);
    const messages = this.db
      .select()
      .from(simpleChatMessages)
      .where(eq(simpleChatMessages.threadId, threadId))
      .orderBy(asc(simpleChatMessages.createdAt))
      .all();
    return { thread, messages };
  }

  async updateThread(
    threadId: string,
    input: { title?: unknown; model?: unknown; cwd?: unknown },
  ) {
    this.requireThread(threadId);
    const updates: {
      title?: string;
      model?: string;
      cwd?: string;
      updatedAt: number;
    } = {
      updatedAt: Date.now(),
    };
    if (typeof input.title === 'string') {
      const title = input.title.trim();
      if (!title || title.length > 120) {
        throw BusinessException.badRequest(
          ErrorCode.simpleChat.titleInvalid,
          'The title must contain between 1 and 120 characters',
        );
      }
      updates.title = title;
    }
    if (input.model !== undefined) {
      const model = this.parseModel(input.model);
      if (!model) {
        throw BusinessException.badRequest(
          ErrorCode.simpleChat.modelInvalid,
          'The model is invalid',
        );
      }
      updates.model = model;
    }
    if (input.cwd !== undefined) {
      updates.cwd = await this.resolveWorkspace(input.cwd);
    }
    this.db
      .update(simpleChatThreads)
      .set(updates)
      .where(eq(simpleChatThreads.id, threadId))
      .run();
    return this.readThread(threadId);
  }

  /** Requires a real directory covered by the configured workspace roots. */
  private async resolveWorkspace(value: unknown): Promise<string> {
    if (typeof value !== 'string' || !value.trim()) {
      throw BusinessException.badRequest(
        ErrorCode.files.pathRequired,
        'A workspace directory is required',
      );
    }
    return this.filesService.resolveSafePath(value.trim());
  }

  deleteThread(threadId: string) {
    this.requireThread(threadId);
    this.db
      .delete(simpleChatThreads)
      .where(eq(simpleChatThreads.id, threadId))
      .run();
    return { deleted: true };
  }

  async respond(threadId: string, input: { message?: unknown }) {
    const message =
      typeof input?.message === 'string' ? input.message.trim() : '';
    if (!message) {
      throw BusinessException.badRequest(
        ErrorCode.simpleChat.messageRequired,
        'message is required',
      );
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw BusinessException.badRequest(
        ErrorCode.simpleChat.messageTooLong,
        `message must be at most ${MAX_MESSAGE_LENGTH} characters`,
      );
    }

    const thread = this.requireThread(threadId);
    const previousMessages = this.db
      .select({
        role: simpleChatMessages.role,
        content: simpleChatMessages.content,
      })
      .from(simpleChatMessages)
      .where(eq(simpleChatMessages.threadId, threadId))
      .orderBy(desc(simpleChatMessages.createdAt))
      .limit(MAX_CONTEXT_MESSAGES)
      .all()
      .reverse();
    const response = await this.createResponse(thread.model, [
      ...previousMessages,
      { role: 'user', content: message },
    ]);
    const text = this.extractText(response);
    if (!text) {
      const detail = response.incomplete_details?.reason
        ? `OpenAI stopped before producing text (${response.incomplete_details.reason})`
        : 'OpenAI returned an empty response';
      throw BusinessException.internal(
        ErrorCode.simpleChat.invalidResponse,
        detail,
      );
    }

    const now = Date.now();
    const sources = this.extractSources(response);
    const userMessage = {
      id: randomUUID(),
      threadId,
      role: 'user',
      content: message,
      model: null,
      sources: [] as SimpleChatSource[],
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      createdAt: now,
    };
    const assistantMessage = {
      id: randomUUID(),
      threadId,
      role: 'assistant',
      content: text,
      model: response.model || thread.model,
      sources,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
      createdAt: now + 1,
    };
    const isFirstMessage = previousMessages.length === 0;
    this.db.transaction((tx) => {
      tx.insert(simpleChatMessages)
        .values([userMessage, assistantMessage])
        .run();
      tx.update(simpleChatThreads)
        .set({
          title: isFirstMessage ? this.makeTitle(message) : thread.title,
          updatedAt: now,
        })
        .where(eq(simpleChatThreads.id, threadId))
        .run();
    });
    return { message: assistantMessage, thread: this.requireThread(threadId) };
  }

  private async createResponse(
    model: string,
    messages: Array<{ role: string; content: string }>,
  ): Promise<OpenAiResponse> {
    const response = await this.openAiRequest('/v1/responses', {
      method: 'POST',
      body: JSON.stringify({
        model,
        input: messages.map((item) => ({
          role: item.role,
          content: item.content,
        })),
        instructions:
          'You are a concise, helpful general-purpose assistant. Answer in the language used by the user. Use web search for current or time-sensitive information and cite sources. Do not claim access to files, terminals, Home Assistant, SSH, or external tools other than web search.',
        tools: [{ type: 'web_search', search_context_size: 'low' }],
        tool_choice: 'auto',
        include: ['web_search_call.action.sources'],
        ...(/^(gpt-[56]|o[1-9](?:-|$))/.test(model)
          ? { reasoning: { effort: 'low' } }
          : {}),
        store: false,
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as OpenAiResponse;
    if (!response.ok) {
      throw BusinessException.internal(
        ErrorCode.simpleChat.upstreamFailed,
        payload.error?.message || `OpenAI API returned HTTP ${response.status}`,
      );
    }
    return payload;
  }

  private async openAiRequest(
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(`https://api.openai.com${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.readApiKey()}`,
          ...(init.body && !(init.body instanceof FormData)
            ? { 'Content-Type': 'application/json' }
            : {}),
          ...init.headers,
        },
        signal: controller.signal,
      });
    } catch (error) {
      const message =
        error instanceof Error && error.name === 'AbortError'
          ? 'OpenAI API request timed out'
          : 'Unable to contact the OpenAI API';
      throw BusinessException.internal(
        ErrorCode.simpleChat.upstreamFailed,
        message,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private requireThread(threadId: string) {
    const thread = this.db
      .select()
      .from(simpleChatThreads)
      .where(eq(simpleChatThreads.id, threadId))
      .get();
    if (!thread) {
      throw BusinessException.notFound(
        ErrorCode.simpleChat.threadNotFound,
        'Simple Chat conversation not found',
      );
    }
    return thread;
  }

  private readApiKey(): string {
    const key =
      this.readKeyFile(this.managedKeyFile) ||
      (this.externalKeyFile
        ? this.readKeyFile(this.externalKeyFile)
        : undefined);
    if (!key) {
      throw BusinessException.internal(
        ErrorCode.simpleChat.notConfigured,
        'Simple Chat API key is unavailable',
      );
    }
    return key;
  }

  private hasApiKey(): boolean {
    return Boolean(
      this.readKeyFile(this.managedKeyFile) ||
      (this.externalKeyFile
        ? this.readKeyFile(this.externalKeyFile)
        : undefined),
    );
  }

  private readKeyFile(path: string): string | undefined {
    try {
      return readFileSync(path, 'utf8').trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private extractText(payload: OpenAiResponse): string {
    return (payload.output ?? [])
      .flatMap((item) => item.content ?? [])
      .filter(
        (part) => part.type === 'output_text' && typeof part.text === 'string',
      )
      .map((part) => part.text!.trim())
      .filter(Boolean)
      .join('\n\n');
  }

  private extractSources(payload: OpenAiResponse): SimpleChatSource[] {
    const seen = new Set<string>();
    const sources: SimpleChatSource[] = [];
    for (const annotation of (payload.output ?? [])
      .flatMap((item) => item.content ?? [])
      .flatMap((part) => part.annotations ?? [])) {
      const url = annotation.url || annotation.url_citation?.url;
      const title = annotation.title || annotation.url_citation?.title || url;
      if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      sources.push({ title: title || url, url });
    }
    for (const source of (payload.output ?? []).flatMap(
      (item) => item.action?.sources ?? [],
    )) {
      const url = source.url;
      if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      sources.push({ title: source.title || url, url });
    }
    return sources;
  }

  private parseModel(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const model = value.trim();
    return /^[a-zA-Z0-9._:-]{2,100}$/.test(model) ? model : undefined;
  }

  private isChatModel(id: string): boolean {
    return (
      /^(gpt-|o[1-9](?:-|$))/.test(id) &&
      !/^gpt-3\.5/i.test(id) &&
      !/(audio|realtime|transcribe|tts|image|search|codex|instruct|embedding|moderation)/i.test(
        id,
      )
    );
  }

  private modelRank(id: string): number {
    const preferred = [
      this.defaultModel,
      'gpt-5-mini',
      'gpt-5-nano',
      'gpt-4.1-mini',
      'gpt-4.1',
    ];
    const index = preferred.indexOf(id);
    return index === -1 ? 100 : index;
  }

  private makeTitle(message: string): string {
    const oneLine = message.replace(/\s+/g, ' ').trim();
    return oneLine.length <= 60 ? oneLine : `${oneLine.slice(0, 57)}…`;
  }
}
