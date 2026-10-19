import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  Folder,
  FolderCog,
  FolderPlus,
  Loader2,
  Plug,
  Save,
  Settings,
  Star,
  Unlink,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PeopleManager } from './people-manager';
import { DirectoryPickerDialog } from '@/components/chat/sidebar/directory-picker-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { mcpServersListServers } from '@/generated/api';
import { mcpServersListServersQueryKey } from '@/generated/api/@tanstack/react-query.gen';
import {
  projectsApi,
  projectsQueryKey,
  type ProjectSummary,
} from '@/lib/projects-api';
import { cn } from '@/lib/utils';
import type { McpServerStatus } from '@/types/mcp';

type Section = 'general' | 'workspaces' | 'participants' | 'mcps';

export function ProjectSettingsDialog({
  project,
  open,
  onClose,
}: {
  project: ProjectSummary;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [section, setSection] = useState<Section>('general');
  const [name, setName] = useState(project.name);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState('');
  const [mcpServerIds, setMcpServerIds] = useState<string[]>(
    project.mcpServerIds ?? [],
  );
  const mcpServers = useQuery({
    queryKey: mcpServersListServersQueryKey({
      query: { detail: 'toolsAndAuthOnly' },
    }),
    queryFn: async () => {
      const { data } = await mcpServersListServers({
        query: { detail: 'toolsAndAuthOnly' },
        throwOnError: true,
      });
      return (data?.data ?? []) as unknown as McpServerStatus[];
    },
    enabled: section === 'mcps',
  });

  const refresh = async () => {
    setError('');
    await client.invalidateQueries({ queryKey: projectsQueryKey });
  };
  const fail = (reason: unknown) =>
    setError(
      reason instanceof Error ? reason.message : t('Unable to save project'),
    );

  const rename = useMutation({
    mutationFn: (nextName: string) =>
      projectsApi(`/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: nextName }),
      }),
    onSuccess: refresh,
    onError: fail,
  });
  const addWorkspace = useMutation({
    mutationFn: (path: string) =>
      projectsApi(`/${project.id}/workspaces`, {
        method: 'POST',
        body: JSON.stringify({ path }),
      }),
    onSuccess: async () => {
      setPickerOpen(false);
      await refresh();
    },
    onError: fail,
  });
  const setDefaultWorkspace = useMutation({
    mutationFn: (workspaceId: string) =>
      projectsApi(`/${project.id}/workspaces/${workspaceId}/default`, {
        method: 'PATCH',
      }),
    onSuccess: refresh,
    onError: fail,
  });
  const detachWorkspace = useMutation({
    mutationFn: (workspaceId: string) =>
      projectsApi(`/${project.id}/workspaces/${workspaceId}`, {
        method: 'DELETE',
      }),
    onSuccess: refresh,
    onError: fail,
  });
  const saveMcpServers = useMutation({
    mutationFn: (names: string[]) =>
      projectsApi(`/${project.id}/mcp-servers`, {
        method: 'PATCH',
        body: JSON.stringify({ names }),
      }),
    onSuccess: refresh,
    onError: fail,
  });
  const pending =
    rename.isPending ||
    addWorkspace.isPending ||
    setDefaultWorkspace.isPending ||
    detachWorkspace.isPending ||
    saveMcpServers.isPending;

  const tabs: Array<{ id: Section; label: string; icon: typeof Settings }> = [
    { id: 'general', label: t('General settings'), icon: Settings },
    { id: 'workspaces', label: t('Workspaces'), icon: FolderCog },
    { id: 'participants', label: t('Participants'), icon: Users },
    { id: 'mcps', label: t('MCP connectors'), icon: Plug },
  ];

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => !value && !pending && onClose()}
      >
        <DialogContent className="flex h-[85dvh] max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>{t('Project settings')}</DialogTitle>
            <DialogDescription>
              {t('Manage the project name, workspaces and participants.')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex shrink-0 gap-1 overflow-x-auto border-b px-4 pt-2">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={cn(
                  'flex h-10 cursor-pointer items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm transition-colors',
                  section === id
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
                onClick={() => {
                  setSection(id);
                  setError('');
                }}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {section === 'general' && (
              <section className="space-y-4">
                <div>
                  <h3 className="font-semibold">{t('General settings')}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('Change the name displayed throughout the application.')}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor="project-settings-name"
                      className="mb-1 block text-sm font-medium"
                    >
                      {t('Project name')}
                    </label>
                    <Input
                      id="project-settings-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </div>
                  <Button
                    className="mt-auto cursor-pointer"
                    disabled={
                      pending || !name.trim() || name.trim() === project.name
                    }
                    onClick={() => rename.mutate(name.trim())}
                  >
                    <Save className="h-4 w-4" />
                    {t('Save')}
                  </Button>
                </div>
              </section>
            )}

            {section === 'workspaces' && (
              <section className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{t('Manage workspaces')}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t(
                        'Add, choose the default workspace, or detach a workspace without deleting its files.',
                      )}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={pending}
                    onClick={() => setPickerOpen(true)}
                  >
                    <FolderPlus className="h-4 w-4" />
                    {t('Add a workspace')}
                  </Button>
                </div>
                {project.workspaces.map((workspace) => {
                  const agents = (project.agentThreads ?? []).filter(
                    (thread) => thread.workspacePath === workspace.path,
                  );
                  return (
                    <div
                      key={workspace.id}
                      className="space-y-3 rounded-lg border p-3"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-40 flex-1">
                          <div className="flex items-center gap-2 font-medium">
                            <span className="truncate">{workspace.name}</span>
                            {workspace.primary && (
                              <Badge variant="secondary">{t('Default')}</Badge>
                            )}
                          </div>
                          <div
                            className="truncate font-mono text-[11px] text-muted-foreground"
                            title={workspace.path}
                          >
                            {workspace.path}
                          </div>
                        </div>
                        {!workspace.primary && (
                          <div className="flex flex-wrap gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={pending}
                              onClick={() =>
                                setDefaultWorkspace.mutate(workspace.id)
                              }
                            >
                              {setDefaultWorkspace.isPending ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Star className="h-3.5 w-3.5" />
                              )}
                              {t('Set as default')}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              disabled={pending}
                              onClick={() =>
                                detachWorkspace.mutate(workspace.id)
                              }
                            >
                              <Unlink className="h-3.5 w-3.5" />
                              {t('Detach')}
                            </Button>
                          </div>
                        )}
                      </div>
                      <div className="ml-7 space-y-1.5 border-l pl-3">
                        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                          {t('Associated conversations')} ({agents.length})
                        </div>
                        {agents.length === 0 ? (
                          <p className="text-xs italic text-muted-foreground">
                            {t('No associated conversation')}
                          </p>
                        ) : (
                          agents.map((thread) => (
                            <div
                              key={thread.threadId}
                              className="flex min-w-0 items-center gap-2 text-xs"
                            >
                              <Bot className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{thread.title}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                })}
              </section>
            )}

            {section === 'participants' && (
              <PeopleManager projectId={project.id} />
            )}
            {section === 'mcps' && (
              <section className="space-y-4">
                <div>
                  <h3 className="font-semibold">{t('MCP connectors')}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t(
                      'Choose which MCP connectors can be used inside this project.',
                    )}
                  </p>
                </div>
                {mcpServers.isPending ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('Loading…')}
                  </div>
                ) : mcpServers.isError ? (
                  <p className="text-sm text-destructive">
                    {t('Failed to load MCP servers')}
                  </p>
                ) : mcpServers.data.length === 0 ? (
                  <p className="rounded-lg border p-4 text-sm text-muted-foreground">
                    {t('No MCP connector is configured on the server.')}
                  </p>
                ) : (
                  <div className="divide-y rounded-lg border">
                    {mcpServers.data.map((server) => {
                      const enabled = mcpServerIds.includes(server.name);
                      return (
                        <label
                          key={server.name}
                          className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-accent/40"
                        >
                          <Plug className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">
                              {server.name}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {t('{{count}} available tools', {
                                count: Object.keys(server.tools ?? {}).length,
                              })}
                            </span>
                          </span>
                          <Switch
                            checked={enabled}
                            onCheckedChange={(checked) =>
                              setMcpServerIds((current) =>
                                checked
                                  ? [...new Set([...current, server.name])]
                                  : current.filter(
                                      (name) => name !== server.name,
                                    ),
                              )
                            }
                            aria-label={server.name}
                          />
                        </label>
                      );
                    })}
                  </div>
                )}
                <div className="flex justify-end">
                  <Button
                    disabled={pending || mcpServers.isPending}
                    onClick={() => saveMcpServers.mutate(mcpServerIds)}
                  >
                    {saveMcpServers.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    {t('Save')}
                  </Button>
                </div>
              </section>
            )}
            {error && (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="shrink-0 border-t bg-background px-5 py-3">
            <Button variant="secondary" disabled={pending} onClick={onClose}>
              {t('Close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DirectoryPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(path) => addWorkspace.mutate(path)}
      />
    </>
  );
}
