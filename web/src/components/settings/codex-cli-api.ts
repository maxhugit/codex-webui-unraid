import { getAuthorizationHeader } from '@/auth-token';
import { withBasePath } from '@/base-path';

export interface CliStatus {
  selectedVersion: string | null;
  installedVersion: string | null;
  latestVersion: string | null;
  installationState: 'missing' | 'legacy' | 'managed' | 'external';
  updateAvailable: boolean;
  installedError: string | null;
  checkError: string | null;
  checkedAt: string | null;
  canManage: boolean;
  canRollback: boolean;
  busy: boolean;
}

export const cliStatusQueryKey = ['administration', 'codex-cli'] as const;

export async function requestCli<T>(path = '', body?: unknown): Promise<T> {
  const authorization = getAuthorizationHeader();
  const response = await fetch(withBasePath(`/api/codex/cli${path}`), {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(authorization ? { Authorization: authorization } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await response.json()) as T & {
    message?: string | string[];
    blockers?: { reason: string }[];
  };
  if (!response.ok)
    throw new Error(
      [
        ...(Array.isArray(data.message)
          ? data.message
          : [data.message ?? `HTTP ${response.status}`]),
        ...(data.blockers?.map((blocker) => blocker.reason) ?? []),
      ].join('\n'),
    );
  return data;
}
