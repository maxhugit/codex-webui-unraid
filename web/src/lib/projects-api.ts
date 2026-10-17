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
    taskId: string | null;
    taskResourceId: string | null;
    taskTitle: string | null;
    isSubtask: boolean;
  }>;
}

export interface ProjectResourceSummary {
  id: string;
  projectId: string;
  type: 'task_board' | 'automation_board';
  name: string;
  config: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  taskCount?: number;
}

export interface ProjectTaskStatusSummary {
  id: string;
  resourceId: string;
  name: string;
  color: string;
  kind: string;
  position: number;
  system: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectTaskSummary {
  id: string;
  resourceId: string;
  statusId: string;
  title: string;
  description: string;
  priority: string;
  parentTaskId: string | null;
  subtaskStatus: 'todo' | 'started' | 'review' | 'done' | 'cancelled';
  workspacePath: string | null;
  executionMode: 'manual' | 'agent';
  agentState:
    | 'manual'
    | 'ready'
    | 'running'
    | 'waiting'
    | 'error'
    | 'review'
    | 'validated';
  estimateMinutes: number;
  progress: number;
  startAt: number | null;
  dueAt: number | null;
  validationCriteria: string;
  labels: string[];
  linkedThreadId: string | null;
  linkedSimpleChatId: string | null;
  linkedFilePath: string | null;
  position: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectTaskBoard {
  resource: ProjectResourceSummary;
  project: Pick<ProjectSummary, 'id' | 'name' | 'workspacePath'>;
  workspaces: ProjectWorkspaceSummary[];
  statuses: ProjectTaskStatusSummary[];
  tasks: ProjectTaskSummary[];
  activity: ProjectTaskActivitySummary[];
  dependencies: Array<{
    taskId: string;
    dependsOnTaskId: string;
    createdAt: number;
  }>;
}

export interface ProjectTaskActivitySummary {
  id: string;
  resourceId: string;
  taskId: string;
  taskTitle: string;
  parentTaskId: string | null;
  action: 'created' | 'updated' | 'deleted';
  changes: Record<string, { before: unknown; after: unknown }>;
  createdAt: number;
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
