import { useCallback, useEffect, useState } from 'react';
import { Cable, PlugZap, Unlink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  projectsApi,
  projectsQueryKey,
  type ProjectSummary,
  type ProjectWorkspaceCopySummary,
  type ProjectWorkspaceResourceSummary,
} from '@/lib/projects-api';
import { WorkspaceTransfers } from './workspace-transfers';

const emptyForm = {
  name: '',
  type: 'git',
  address: '',
  rootPath: '/',
  accessMode: 'read_only',
  username: '',
  password: '',
  knownHosts: '',
  allowInsecure: false,
};

export function ExternalWorkspaceResources({
  project,
  pending,
  allowCreate = true,
}: {
  project: ProjectSummary;
  pending: boolean;
  allowCreate?: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [resources, setResources] = useState<ProjectWorkspaceResourceSummary[]>(
    [],
  );
  const [copies, setCopies] = useState<ProjectWorkspaceCopySummary[]>([]);
  const [copying, setCopying] = useState<string | null>(null);
  const [copyBranch, setCopyBranch] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const result = await projectsApi<{
        resources: ProjectWorkspaceResourceSummary[];
        copies: ProjectWorkspaceCopySummary[];
      }>(`/${project.id}/workspace-resources`);
      setResources(
        result.resources.filter((resource) => resource.type !== 'local'),
      );
      setCopies(result.copies);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [project.id]);
  useEffect(() => {
    // Network completion updates the resource inventory for the opened project.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const mutate = async (path: string, init: RequestInit) => {
    setBusy(true);
    setError('');
    try {
      await projectsApi(path, init);
      await load();
      await queryClient.invalidateQueries({ queryKey: projectsQueryKey });
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    const created = await mutate(`/${project.id}/workspace-resources`, {
      method: 'POST',
      body: JSON.stringify({
        name: form.name,
        type: form.type,
        address: form.address,
        rootPath: form.rootPath,
        accessMode: form.accessMode,
        allowInsecure: form.allowInsecure,
        secret:
          form.username || form.password || form.knownHosts
            ? {
                username: form.username,
                password: form.password,
                knownHosts: form.knownHosts,
              }
            : undefined,
      }),
    });
    if (created) {
      setEditing(false);
      setForm(emptyForm);
    }
  };
  const field =
    'rounded-md border border-input bg-background px-3 py-2 text-sm';
  const stateLabel = (
    state: ProjectWorkspaceResourceSummary['connectionState'],
  ) => {
    switch (state) {
      case 'local':
        return t('localResource');
      case 'untested':
        return t('notTested');
      case 'connected':
        return t('connected');
      case 'unreachable':
        return t('unreachable');
      case 'disabled':
        return t('disabled');
    }
  };
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{t('externalResources')}</h3>
          <p className="text-xs text-muted-foreground">
            {t('externalResourcesDescription')}
          </p>
        </div>
        {allowCreate && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || busy}
            onClick={() => setEditing(!editing)}
          >
            <Cable className="h-4 w-4" />
            {t('addAConnection')}
          </Button>
        )}
      </div>
      {editing && (
        <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-2">
          <input
            className={field}
            placeholder={t('connectionName')}
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
          {['ssh', 'sftp'].includes(form.type) && (
            <textarea
              className={`${field} min-h-20 sm:col-span-2`}
              placeholder={t('knownHostsEntry')}
              value={form.knownHosts}
              onChange={(event) =>
                setForm({ ...form, knownHosts: event.target.value })
              }
            />
          )}
          <select
            className={field}
            value={form.type}
            onChange={(event) => setForm({ ...form, type: event.target.value })}
          >
            {['git', 'ssh', 'sftp', 'ftps', 'ftp'].map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
          <input
            className={`${field} sm:col-span-2`}
            placeholder={t('connectionAddress')}
            value={form.address}
            onChange={(event) =>
              setForm({ ...form, address: event.target.value })
            }
          />
          <input
            className={field}
            placeholder={t('allowedRoot')}
            value={form.rootPath}
            onChange={(event) =>
              setForm({ ...form, rootPath: event.target.value })
            }
          />
          <select
            className={field}
            value={form.accessMode}
            onChange={(event) =>
              setForm({ ...form, accessMode: event.target.value })
            }
          >
            <option value="read_only">{t('readOnly')}</option>
            <option value="read_write">{t('readAndWrite')}</option>
          </select>
          <input
            className={field}
            placeholder={t('username')}
            autoComplete="off"
            value={form.username}
            onChange={(event) =>
              setForm({ ...form, username: event.target.value })
            }
          />
          <input
            className={field}
            placeholder={t('passwordOrToken')}
            type="password"
            autoComplete="new-password"
            value={form.password}
            onChange={(event) =>
              setForm({ ...form, password: event.target.value })
            }
          />
          {form.type === 'ftp' && (
            <label className="flex items-center gap-2 text-xs sm:col-span-2">
              <input
                type="checkbox"
                checked={form.allowInsecure}
                onChange={(event) =>
                  setForm({ ...form, allowInsecure: event.target.checked })
                }
              />
              {t('allowPlainFtp')}
            </label>
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('cancel')}
            </Button>
            <Button
              size="sm"
              disabled={busy || !form.name || !form.address}
              onClick={() => void create()}
            >
              {t('addAConnection')}
            </Button>
          </div>
        </div>
      )}
      {resources.map((resource) => (
        <div
          key={resource.id}
          className="space-y-2 rounded-lg border border-border p-3"
        >
          <div className="flex items-center gap-3">
            <PlugZap className="h-4 w-4 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="truncate">{resource.name}</span>
                <Badge variant="secondary">{resource.type.toUpperCase()}</Badge>
                <Badge
                  variant={
                    resource.connectionState === 'connected'
                      ? 'default'
                      : 'outline'
                  }
                >
                  {stateLabel(resource.connectionState)}
                </Badge>
              </div>
              <div className="truncate font-mono text-[11px] text-muted-foreground">
                {resource.address} · {resource.rootPath} ·{' '}
                {resource.accessMode === 'read_only'
                  ? t('readOnly')
                  : t('readAndWrite')}
              </div>
              {resource.lastError && (
                <p className="text-xs text-destructive">{resource.lastError}</p>
              )}
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !resource.enabled}
                onClick={() =>
                  void mutate(
                    `/${project.id}/workspace-resources/${resource.id}/test`,
                    { method: 'POST' },
                  )
                }
              >
                {t('test')}
              </Button>
              {resource.type === 'git' && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || !resource.enabled}
                  onClick={() => {
                    setCopying(copying === resource.id ? null : resource.id);
                    setCopyBranch('');
                  }}
                >
                  {t('createWorkingCopy')}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void mutate(
                    `/${project.id}/workspace-resources/${resource.id}/${resource.enabled ? 'disable' : 'enable'}`,
                    { method: 'POST' },
                  )
                }
              >
                {resource.enabled ? t('disable') : t('enable')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={busy}
                onClick={() =>
                  void mutate(
                    `/${project.id}/workspace-resources/${resource.id}`,
                    { method: 'DELETE' },
                  )
                }
              >
                <Unlink className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          {copying === resource.id && (
            <div className="flex items-center gap-2 border-t border-border pt-2">
              <input
                className={`${field} min-w-0 flex-1`}
                placeholder={t('gitBranchOptional')}
                value={copyBranch}
                onChange={(event) => setCopyBranch(event.target.value)}
              />
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void mutate(
                    `/${project.id}/workspace-resources/${resource.id}/copies`,
                    {
                      method: 'POST',
                      body: JSON.stringify({ branch: copyBranch || undefined }),
                    },
                  ).then((created) => created && setCopying(null))
                }
              >
                {t('createCopy')}
              </Button>
            </div>
          )}
          {copies
            .filter((copy) => copy.sourceResourceId === resource.id)
            .map((copy) => (
              <div
                key={copy.id}
                className="ml-7 flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{copy.name}</div>
                  <div className="truncate font-mono text-muted-foreground">
                    {copy.branch ?? t('detachedRevision')} ·{' '}
                    {copy.revision.slice(0, 12)} ·{' '}
                    {copy.accessMode === 'read_only'
                      ? t('readOnly')
                      : t('readAndWrite')}
                  </div>
                </div>
                <Badge
                  variant={copy.state === 'ready' ? 'secondary' : 'destructive'}
                >
                  {copy.state === 'ready' ? t('ready') : t('revoked')}
                </Badge>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      `/${project.id}/workspace-resources/copies/${copy.id}`,
                      { method: 'DELETE' },
                    )
                  }
                >
                  <Unlink className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
        </div>
      ))}
      {resources.length === 0 && !editing && (
        <p className="text-xs italic text-muted-foreground">
          {t('noExternalResource')}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <WorkspaceTransfers project={project} />
    </div>
  );
}
