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
  const response = await fetch(withBasePath(`/api/auth/${path}`), {
    credentials: 'same-origin',
    headers: authorization ? { Authorization: authorization } : {},
  });
  if (!response.ok) throw new Error('Unable to verify your identity');
  return response.json() as Promise<T>;
}
export function usePlatformSession() {
  const query = useQuery({
    queryKey: platformSessionKey,
    queryFn: () => readAuthResource<PlatformSession>('me'),
    staleTime: 10_000,
    refetchInterval: 30_000,
    retry: false,
  });
  return {
    ...query,
    isAdministrator:
      query.data?.active === true && query.data.role === 'administrator',
  };
}
