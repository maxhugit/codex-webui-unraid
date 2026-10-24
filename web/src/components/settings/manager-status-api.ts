import { getAuthorizationHeader } from '@/auth-token';
import { withBasePath } from '@/base-path';

export type ManagerComponentState =
  | 'missing'
  | 'conflict'
  | 'created'
  | 'stopped'
  | 'running'
  | 'starting'
  | 'healthy'
  | 'unhealthy';

export interface ManagerProtectedMount {
  component: string;
  target: string;
  purpose: string;
  present: boolean;
  source: string | null;
  type: string | null;
  writable: boolean;
}

export interface ManagerComponent {
  id: 'application' | 'ingress' | 'egress';
  displayName: string;
  state: ManagerComponentState;
  adoption: 'managed' | 'adoptable' | 'missing' | 'conflict';
  containerId: string | null;
  containerName: string | null;
  image: string | null;
  imageRepositoryAllowed: boolean | null;
  health: string | null;
  restartCount: number;
  networks: string[];
  missingNetworks: string[];
  protectedMounts: Omit<ManagerProtectedMount, 'component'>[];
}

export interface ManagerStatus {
  available: boolean;
  schemaVersion?: number;
  stack?: string;
  environment?: 'production' | 'development';
  mode: 'observe';
  observedAt?: string;
  dockerConnected: boolean;
  components: ManagerComponent[];
  dataSafety: {
    status: 'protected' | 'blocked' | 'unknown';
    blockers: string[];
    protectedMounts: ManagerProtectedMount[];
  };
  adoption?: {
    state: 'eligible' | 'blocked' | 'adopted' | 'drifted';
    fingerprint: string;
    adoptedAt: string | null;
    blockers: string[];
    canAdopt: boolean;
  };
  error?: string;
}

export const managerStatusQueryKey = ['administration', 'manager-status'];

export async function requestManagerStatus(): Promise<ManagerStatus> {
  const authorization = getAuthorizationHeader();
  const response = await fetch(withBasePath('/api/settings/manager/status'), {
    headers: authorization ? { Authorization: authorization } : {},
  });
  const data = (await response.json()) as ManagerStatus & {
    message?: string | string[];
  };
  if (!response.ok) {
    const message = Array.isArray(data.message)
      ? data.message.join('\n')
      : data.message;
    throw new Error(message ?? `HTTP ${response.status}`);
  }
  return data;
}

export async function requestManagerAdoption(
  expectedFingerprint: string,
): Promise<ManagerStatus> {
  const authorization = getAuthorizationHeader();
  const response = await fetch(withBasePath('/api/settings/manager/adopt'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify({
      confirmation: 'ADOPT_EXISTING_INSTALLATION',
      expectedFingerprint,
    }),
  });
  const data = (await response.json()) as ManagerStatus & {
    error?: string;
    message?: string | string[];
  };
  if (!response.ok) {
    const message = Array.isArray(data.message)
      ? data.message.join('\n')
      : data.message;
    throw new Error(message ?? data.error ?? `HTTP ${response.status}`);
  }
  return data;
}
