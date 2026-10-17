import { getAuthorizationHeader } from '@/auth-token';
import { withBasePath } from '@/base-path';

export interface ProjectSummary {
  id: string;
  name: string;
  workspacePath: string;
  createdAt: number;
  updatedAt: number;
  workspaces: ProjectWorkspaceSummary[];
}

export interface ProjectWorkspaceSummary {
  id: string;
  projectId: string;
  name: string;
  path: string;
  primary: boolean;
  createdAt: number;
  updatedAt: number;
}

export const projectsQueryKey = ['projects'] as const;

export async function projectsApi<T>(
  path = '',
  init?: RequestInit,
): Promise<T> {
  const authorization = getAuthorizationHeader();
  const response = await fetch(withBasePath(`/api/projects${path}`), {
    ...init,
    headers: {
      ...(init?.body !== undefined
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(authorization ? { Authorization: authorization } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    message?: string;
  };
  if (!response.ok)
    throw new Error(payload.message || `HTTP ${response.status}`);
  return payload;
}
