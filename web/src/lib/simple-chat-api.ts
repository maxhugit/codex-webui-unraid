import { getAuthorizationHeader } from '@/auth-token';
import { withBasePath } from '@/base-path';

export interface SimpleChatThreadSummary {
  id: string;
  title: string;
  model: string;
  cwd: string;
  createdAt: number;
  updatedAt: number;
}

export const simpleChatThreadsQueryKey = ['simple-chat-threads'] as const;

/** Loads the lightweight conversation list shared by the sidebar and header. */
export async function listSimpleChatThreads(): Promise<{
  threads: SimpleChatThreadSummary[];
}> {
  const authorization = getAuthorizationHeader();
  const response = await fetch(withBasePath('/api/simple-chat/threads'), {
    headers: authorization ? { Authorization: authorization } : {},
  });
  if (!response.ok) {
    throw new Error(`Simple Chat threads request failed (${response.status}).`);
  }
  return response.json() as Promise<{ threads: SimpleChatThreadSummary[] }>;
}
