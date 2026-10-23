import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FolderOpen } from 'lucide-react';
import {
  projectsApi,
  projectsQueryKey,
  type ProjectSummary,
  type ActiveFolderSummary,
} from '@/lib/projects-api';
import { getAuthorizationHeader } from '@/auth-token';
import { withBasePath } from '@/base-path';

export function SimpleChatFolderSelector({
  projectId,
  threadId,
  disabled,
  onSelected,
}: {
  projectId: string;
  threadId: string;
  disabled: boolean;
  onSelected: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const key = ['simple-chat-folder', threadId];
  const projects = useQuery({
    queryKey: projectsQueryKey,
    queryFn: () => projectsApi<{ projects: ProjectSummary[] }>(),
  });
  const folder = useQuery({
    queryKey: key,
    queryFn: async () => {
      const authorization = getAuthorizationHeader();
      const response = await fetch(
        withBasePath(
          `/api/simple-chat/threads/${encodeURIComponent(threadId)}`,
        ),
        { headers: authorization ? { Authorization: authorization } : {} },
      );
      if (!response.ok) throw new Error(t('simpleChatFolderLoadFailed'));
      return response.json() as Promise<{
        activeFolder: ActiveFolderSummary | null;
      }>;
    },
  });
  const change = useMutation({
    mutationFn: (resourceId: string) =>
      projectsApi(`/${projectId}/active-folders/simple_chat/${threadId}`, {
        method: 'PUT',
        body: JSON.stringify({ resourceId, relativePath: '' }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: key });
      onSelected();
    },
  });
  const current = folder.data?.activeFolder;
  const workspaces =
    projects.data?.projects.find((project) => project.id === projectId)
      ?.workspaces ?? [];
  return (
    <div className="mx-auto mb-2 max-w-3xl space-y-1 text-xs">
      <label className="flex min-w-0 items-center gap-2">
        <FolderOpen className="h-4 w-4 shrink-0" />
        <span className="shrink-0">{t('workingFolder')}</span>
        <select
          className="min-w-0 flex-1 rounded-md border bg-background px-2 py-1"
          disabled={
            disabled ||
            change.isPending ||
            folder.isLoading ||
            projects.isLoading
          }
          value={current?.state === 'ready' ? current.resourceId : ''}
          onChange={(event) => {
            if (event.target.value) change.mutate(event.target.value);
          }}
        >
          <option value="" disabled>
            {t('simpleChatChooseFolder')}
          </option>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
              {current?.resourceId === workspace.id && current.relativePath
                ? ` / ${current.relativePath}`
                : ''}
            </option>
          ))}
        </select>
      </label>
      {(change.isError || folder.isError || projects.isError) && (
        <p role="alert" className="text-destructive">
          {t('simpleChatFolderLoadFailed')}
        </p>
      )}
    </div>
  );
}
