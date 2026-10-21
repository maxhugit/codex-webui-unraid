import { getAuthorizationHeader } from '@/auth-token';
import { withBasePath } from '@/base-path';

export interface LocalAccount {
  personId: string;
  name: string;
  email: string | null;
  active: boolean;
  role: 'standard' | 'administrator';
  username: string | null;
  passwordConfigured: boolean;
  oidcLinked: boolean;
  lockedUntil: number | null;
  lastLoginAt: number | null;
}

export const localAccountsKey = ['authentication', 'local-accounts'] as const;

export async function authRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const authorization = getAuthorizationHeader();
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set('Content-Type', 'application/json');
  if (authorization) headers.set('Authorization', authorization);
  const response = await fetch(withBasePath(`/api/auth/${path}`), {
    credentials: 'same-origin',
    ...init,
    headers,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(payload?.message || 'Authentication request failed');
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export const readLocalAccounts = () =>
  authRequest<{ accounts: LocalAccount[] }>('local-accounts');
