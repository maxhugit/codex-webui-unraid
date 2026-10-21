import { useQuery } from '@tanstack/react-query';
import { getAuthorizationHeader } from '@/auth-token';
import { withBasePath } from '@/base-path';

export interface PlatformSession {
  kind: 'person' | 'service' | 'unlinked';
  personId: string | null;
  name: string | null;
  role: 'standard' | 'administrator' | null;
  active: boolean;
  subject?: string;
  email?: string;
  theme?: string;
  language?: string;
}

const SESSION_RETRY_DELAYS_MS = [500, 1_500, 3_000] as const;

export class AuthResourceError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthResourceError';
    this.status = status;
  }
}

export function shouldRetryPlatformSession(
  failureCount: number,
  error: Error,
): boolean {
  if (failureCount >= SESSION_RETRY_DELAYS_MS.length) return false;
  if (error instanceof AuthResourceError)
    return error.status === 408 || error.status === 429 || error.status >= 500;
  return true;
}
export async function updateAuthResource<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const authorization = getAuthorizationHeader();
  const response = await fetch(withBasePath(`/api/auth/${path}`), {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('Unable to save profile preferences');
  return response.json() as Promise<T>;
}
export const platformSessionKey = ['platform-session'] as const;
export async function readAuthResource<T>(path: string): Promise<T> {
  const authorization = getAuthorizationHeader();
  try {
    const response = await fetch(withBasePath(`/api/auth/${path}`), {
      credentials: 'same-origin',
      headers: authorization ? { Authorization: authorization } : {},
    });
    if (!response.ok)
      throw new AuthResourceError(
        'Unable to verify your identity',
        response.status,
      );
    return response.json() as Promise<T>;
  } catch (error) {
    if (!(error instanceof AuthResourceError))
      window.dispatchEvent(new Event('codex-webui:transport-recover'));
    throw error;
  }
}
export function usePlatformSession() {
  const query = useQuery({
    queryKey: platformSessionKey,
    queryFn: () => readAuthResource<PlatformSession>('me'),
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
    retry: shouldRetryPlatformSession,
    retryDelay: (attemptIndex) =>
      SESSION_RETRY_DELAYS_MS[
        Math.min(attemptIndex, SESSION_RETRY_DELAYS_MS.length - 1)
      ],
  });
  return {
    ...query,
    isAdministrator:
      query.data?.active === true && query.data.role === 'administrator',
  };
}
