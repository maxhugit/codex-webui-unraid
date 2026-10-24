import { getAuthorizationHeader } from '@/auth-token';
import { withBasePath } from '@/base-path';

export interface ServerBuildInfo {
  version: string | null;
  revision: string | null;
  builtAt: string | null;
  channel: 'edge' | 'stable' | 'unknown';
}

export interface ServerReleaseNote {
  version: string;
  publishedAt: string | null;
  url: string;
  sections: { heading: string; items: string[] }[];
}

export interface ServerReleaseStatus {
  installed: ServerBuildInfo;
  latestVersion: string | null;
  latestPublishedAt: string | null;
  latestUrl: string | null;
  updateAvailable: boolean;
  versionStatus: 'update_available' | 'current' | 'edge' | 'ahead' | 'unknown';
  releases: ServerReleaseNote[];
  checkedAt: string;
  checkError: string | null;
}

export const serverReleaseQueryKey = ['administration', 'server-release'];

export async function requestServerRelease(
  refresh = false,
): Promise<ServerReleaseStatus> {
  const authorization = getAuthorizationHeader();
  const response = await fetch(
    withBasePath(
      `/api/settings/release/status${refresh ? '?refresh=true' : ''}`,
    ),
    {
      headers: authorization ? { Authorization: authorization } : {},
    },
  );
  const data = (await response.json()) as ServerReleaseStatus & {
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
