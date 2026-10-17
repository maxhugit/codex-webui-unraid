import { getAuthorizationHeader } from '@/auth-token';
import { withBasePath } from '@/base-path';

export interface ProjectSummary {
  id: string;
  name: string;
  workspacePath: string;
  createdAt: number;
  updatedAt: number;
  workspaces: ProjectWorkspaceSummary[];
  resources: ProjectResourceSummary[];
  agentThreads?: Array<{
    threadId: string;
    workspacePath: string;
    title: string;
    archived: boolean;
  }>;
}

export interface ProjectResourceSummary {
  id: string;
  projectId: string;
  type: 'task_board';
  name: string;
  config: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
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

/** Finds the project owning an exact conversation workspace path. */
export function projectForWorkspace(
  projects: readonly ProjectSummary[] | undefined,
  cwd: string | null,
): ProjectSummary | undefined {
  if (!cwd) return undefined;
  return projects?.find((project) =>
    project.workspaces.some((workspace) => workspace.path === cwd),
  );
}

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
