import { getAuthorizationHeader } from '@/auth-token';
import { withBasePath } from '@/base-path';

export interface LogEntry {
  timestamp: string;
  level: string;
  source: string;
  message: string;
  fields: Record<string, unknown>;
}

export interface LogsResponse {
  data: LogEntry[];
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  availableLevels: string[];
  availableSources: string[];
}

export async function readLogs(input: {
  offset: number;
  limit: number;
  levels: string[];
  sources: string[];
}): Promise<LogsResponse> {
  const query = new URLSearchParams({
    offset: String(input.offset),
    limit: String(input.limit),
  });
  if (input.levels.length) query.set('levels', input.levels.join(','));
  if (input.sources.length) query.set('sources', input.sources.join(','));
  const authorization = getAuthorizationHeader();
  const response = await fetch(withBasePath(`/api/logs?${query}`), {
    headers: authorization ? { Authorization: authorization } : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as LogsResponse & {
    message?: string;
  };
  if (!response.ok)
    throw new Error(payload.message || `HTTP ${response.status}`);
  return payload;
}
