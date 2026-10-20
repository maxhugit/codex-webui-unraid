import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  Boxes,
  Folder,
  FolderPlus,
  Loader2,
  Plug,
  Save,
  Unlink,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PeopleManager } from './people-manager';
import { DirectoryPickerDialog } from '@/components/chat/sidebar/directory-picker-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { modelsListModelsOptions } from '@/generated/api/@tanstack/react-query.gen';
import type { ModelDto } from '@/generated/api/types.gen';
import {
  projectsApi,
  projectsQueryKey,
  type ProjectSummary,
} from '@/lib/projects-api';
import type { McpServerStatus } from '@/types/mcp';
import {
  availableProjectApps,
  projectAppsQueryOptions,
  projectMcpServersQueryOptions,
} from '@/lib/project-integrations-queries';

export type ProjectSettingsSection =
  | 'settings'
  | 'workspaces'
  | 'participants'
  | 'mcps';

export function ProjectSettingsPanel({
  project,
  section,
  canManageParticipants,
}: {
  project: ProjectSummary;
  section: ProjectSettingsSection;
  canManageParticipants: boolean;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [name, setName] = useState(project.name);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState('');
  const [mcpServerIds, setMcpServerIds] = useState<string[]>(
    project.mcpServerIds ?? [],
  );
  const [appIds, setAppIds] = useState<string[]>(project.appIds ?? []);
  const [agentModel, setAgentModel] = useState(project.agentModel ?? '');
  const [agentReasoningEffort, setAgentReasoningEffort] = useState(
    project.agentReasoningEffort ?? '',
  );
  const models = useQuery({
    ...modelsListModelsOptions({ query: { includeHidden: true } }),
    staleTime: 60_000,
  });
  const selectedModel = useMemo(
    () =>
      (models.data?.data ?? []).find(
        (model: ModelDto) => model.model === agentModel,
      ),
    [agentModel, models.data?.data],
  );
  const effortOptions = selectedModel?.supportedReasoningEfforts ?? [];
  const mcpServers = useQuery({
    ...projectMcpServersQueryOptions(),
    enabled: section === 'mcps',
  });
  const apps = useQuery({
    ...projectAppsQueryOptions(),
    enabled: section === 'mcps',
  });
  const mcpServerRows = (mcpServers.data?.data ??
    []) as unknown as McpServerStatus[];
  const availableApps = availableProjectApps(apps.data ?? []);

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
  const saveApps = useMutation({
    mutationFn: (ids: string[]) =>
      projectsApi(`/${project.id}/apps`, {
        method: 'PATCH',
        body: JSON.stringify({ ids }),
      }),
    onSuccess: refresh,
    onError: fail,
  });
  const saveAgentSettings = useMutation({
    mutationFn: () =>
      projectsApi(`/${project.id}/agent-settings`, {
        method: 'PATCH',
        body: JSON.stringify({
          model: agentModel || null,
          reasoningEffort: agentReasoningEffort || null,
        }),
      }),
    onSuccess: refresh,
    onError: fail,
  });
  const pending =
    rename.isPending ||
    addWorkspace.isPending ||
    detachWorkspace.isPending ||
    saveMcpServers.isPending ||
    saveApps.isPending ||
    saveAgentSettings.isPending;

  return (
    <>
      <div className="rounded-xl border bg-card p-5">
        {section === 'settings' && (
          <section className="space-y-6">
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
            <div className="space-y-4 border-t pt-6">
              <div>
                <h3 className="font-semibold">{t('Agent configuration')}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(
                    'Choose the model and reasoning effort used by agents and task manager AI in this project.',
                  )}
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1 text-sm font-medium">
                  {t('Model')}
                  <select
                    className="h-9 rounded-md border bg-background px-3 text-sm font-normal text-foreground"
                    value={agentModel}
                    disabled={models.isPending}
                    onChange={(event) => {
                      const value = event.target.value;
                      const model = (models.data?.data ?? []).find(
                        (item: ModelDto) => item.model === value,
                      );
                      setAgentModel(value);
                      setAgentReasoningEffort(
                        model?.defaultReasoningEffort ?? '',
                      );
                    }}
                  >
                    <option value="">{t('Server default')}</option>
                    {(models.data?.data ?? []).map((model: ModelDto) => (
                      <option key={model.id} value={model.model}>
                        {model.displayName || model.model}
                        {model.hidden ? ` · ${t('hidden')}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm font-medium">
                  {t('Reasoning effort')}
                  <select
                    className="h-9 rounded-md border bg-background px-3 text-sm font-normal text-foreground"
                    value={agentReasoningEffort}
                    onChange={(event) =>
                      setAgentReasoningEffort(event.target.value)
                    }
                  >
                    <option value="">{t('Model default')}</option>
                    {effortOptions.map((option) => (
                      <option
                        key={option.reasoningEffort}
                        value={option.reasoningEffort}
                      >
                        {option.reasoningEffort}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex justify-end">
                <Button
                  disabled={
                    pending ||
                    (agentModel === (project.agentModel ?? '') &&
                      agentReasoningEffort ===
                        (project.agentReasoningEffort ?? ''))
                  }
                  onClick={() => saveAgentSettings.mutate()}
                >
                  {saveAgentSettings.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {t('Save')}
                </Button>
              </div>
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
                    'The primary workspace is permanent. Add or detach secondary workspaces without deleting their files. Choose the active workspace in each conversation. The .webui folder is reserved for the application.',
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
                        <Badge variant="secondary">
                          {t(
                            workspace.primary
                              ? 'Primary workspace'
                              : 'Secondary workspace',
                          )}
                        </Badge>
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
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={pending}
                          onClick={() => detachWorkspace.mutate(workspace.id)}
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
          <PeopleManager
            projectId={project.id}
            readOnly={!canManageParticipants}
          />
        )}
        {section === 'mcps' && (
          <section className="space-y-6">
            <div className="space-y-4">
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
              ) : mcpServerRows.length === 0 ? (
                <p className="rounded-lg border p-4 text-sm text-muted-foreground">
                  {t('No MCP connector is configured on the server.')}
                </p>
              ) : (
                <div className="divide-y rounded-lg border">
                  {mcpServerRows.map((server) => {
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
            </div>

            <div className="space-y-4 border-t pt-6">
              <div>
                <h3 className="font-semibold">{t('Applications')}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(
                    'Choose which Codex applications can be used inside this project.',
                  )}
                </p>
              </div>
              {apps.isPending ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('Loading…')}
                </div>
              ) : apps.isError ? (
                <p className="text-sm text-destructive">
                  {t('Failed to load apps')}
                </p>
              ) : availableApps.length === 0 ? (
                <p className="rounded-lg border p-4 text-sm text-muted-foreground">
                  {t('No apps available')}
                </p>
              ) : (
                <div className="divide-y rounded-lg border">
                  {availableApps.map((app) => {
                    const enabled = appIds.includes(app.id);
                    return (
                      <label
                        key={app.id}
                        className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-accent/40"
                      >
                        <Boxes className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {app.name}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {app.description || t('Available')}
                          </span>
                        </span>
                        <Switch
                          checked={enabled}
                          onCheckedChange={(checked) =>
                            setAppIds((current) =>
                              checked
                                ? [...new Set([...current, app.id])]
                                : current.filter((id) => id !== app.id),
                            )
                          }
                          aria-label={app.name}
                        />
                      </label>
                    );
                  })}
                </div>
              )}
              <div className="flex justify-end">
                <Button
                  disabled={pending || apps.isPending}
                  onClick={() => saveApps.mutate(appIds)}
                >
                  {saveApps.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {t('Save')}
                </Button>
              </div>
            </div>
          </section>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <DirectoryPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(path) => addWorkspace.mutate(path)}
      />
    </>
  );
}
