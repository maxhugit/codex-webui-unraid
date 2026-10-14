import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-codes';

const DEFAULT_MODEL = 'gpt-5-mini';
const DEFAULT_MAX_OUTPUT_TOKENS = 700;
const MAX_MESSAGE_LENGTH = 6_000;
const REQUEST_TIMEOUT_MS = 90_000;

interface OpenAiUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

interface OpenAiResponse {
  id?: string;
  model?: string;
  error?: { message?: string };
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: OpenAiUsage;
}

export interface SimpleChatReply {
  responseId: string;
  text: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

@Injectable()
export class SimpleChatService {
  private readonly model = process.env.OPENAI_CHAT_MODEL?.trim() || DEFAULT_MODEL;
  private readonly keyFile = process.env.OPENAI_API_KEY_FILE?.trim();

  getStatus() {
    return {
      configured: this.hasApiKey(),
      model: this.model,
      maxOutputTokens: this.getMaxOutputTokens(),
    };
  }

  async respond(input: {
    message?: unknown;
    previousResponseId?: unknown;
  }): Promise<SimpleChatReply> {
    const message = typeof input?.message === 'string' ? input.message.trim() : '';
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

    const previousResponseId =
      typeof input.previousResponseId === 'string' && input.previousResponseId.trim()
        ? input.previousResponseId.trim()
        : undefined;
    const apiKey = this.readApiKey();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          input: message,
          previous_response_id: previousResponseId,
          instructions:
            'You are a concise, helpful general-purpose assistant. Answer in the language used by the user. Do not claim access to files, terminals, Home Assistant, SSH, or external tools.',
          max_output_tokens: this.getMaxOutputTokens(),
          store: true,
        }),
        signal: controller.signal,
      });

      const payload = (await response.json().catch(() => ({}))) as OpenAiResponse;
      if (!response.ok) {
        throw BusinessException.internal(
          ErrorCode.simpleChat.upstreamFailed,
          payload.error?.message || `OpenAI API returned HTTP ${response.status}`,
        );
      }

      const text = this.extractText(payload);
      if (!payload.id || !text) {
        throw BusinessException.internal(
          ErrorCode.simpleChat.invalidResponse,
          'OpenAI returned an empty or invalid response',
        );
      }

      return {
        responseId: payload.id,
        text,
        model: payload.model || this.model,
        usage: {
          inputTokens: payload.usage?.input_tokens ?? 0,
          outputTokens: payload.usage?.output_tokens ?? 0,
          totalTokens: payload.usage?.total_tokens ?? 0,
        },
      };
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      const message =
        error instanceof Error && error.name === 'AbortError'
          ? 'OpenAI API request timed out'
          : 'Unable to contact the OpenAI API';
      throw BusinessException.internal(ErrorCode.simpleChat.upstreamFailed, message);
    } finally {
      clearTimeout(timeout);
    }
  }

  private readApiKey(): string {
    if (!this.keyFile) {
      throw BusinessException.internal(
        ErrorCode.simpleChat.notConfigured,
        'Simple Chat is not configured',
      );
    }
    try {
      const key = readFileSync(this.keyFile, 'utf8').trim();
      if (!key) throw new Error('empty key');
      return key;
    } catch {
      throw BusinessException.internal(
        ErrorCode.simpleChat.notConfigured,
        'Simple Chat API key is unavailable',
      );
    }
  }

  private hasApiKey(): boolean {
    if (!this.keyFile) return false;
    try {
      return readFileSync(this.keyFile, 'utf8').trim().length > 0;
    } catch {
      return false;
    }
  }

  private getMaxOutputTokens(): number {
    const configured = Number(process.env.OPENAI_CHAT_MAX_OUTPUT_TOKENS);
    if (!Number.isInteger(configured) || configured < 64 || configured > 4_096) {
      return DEFAULT_MAX_OUTPUT_TOKENS;
    }
    return configured;
  }

  private extractText(payload: OpenAiResponse): string {
    return (payload.output ?? [])
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
      .map((part) => part.text!.trim())
      .filter(Boolean)
      .join('\n\n');
  }
}
