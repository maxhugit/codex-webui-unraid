import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createTestDatabase,
  type TestDatabase,
} from '../database/database.testing';
import {
  projects,
  projectWorkspaces,
  projectAgentThreads,
  simpleChatThreads,
} from '../database/schema';
import { ProjectWorkspaceLayout } from './project-workspace-layout';
import { FilesService } from '../files/files.service';
import type { SettingsService } from '../settings/settings.service';
import { SECURITY_SETTING_KEYS } from '../settings/settings.definitions';
import { ProjectsService } from './projects.service';

describe('permanent project workspaces', () => {
  let database: TestDatabase;
  let root: string;
  let legacy: string;
  let layout: ProjectWorkspaceLayout;
  let files: FilesService;
  beforeEach(async () => {
    database = createTestDatabase();
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-layout-'));
    legacy = path.join(root, 'existing');
    await fs.mkdir(legacy);
    await fs.writeFile(path.join(legacy, 'AGENTS.md'), 'Existing instructions');
    const now = Date.now();
    database.db
      .insert(projects)
      .values({
        id: 'project-id',
        name: 'My project',
        workspacePath: legacy,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.db
      .insert(projectWorkspaces)
      .values({
        id: 'legacy',
        projectId: 'project-id',
        name: 'Existing',
        path: legacy,
        primary: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.db
      .insert(projectAgentThreads)
      .values({
        threadId: 'agent',
        projectId: 'project-id',
        workspacePath: legacy,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.db
      .insert(simpleChatThreads)
      .values({
        id: 'chat',
        title: 'Chat',
        model: 'codex',
        projectId: 'project-id',
        cwd: legacy,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    layout = new ProjectWorkspaceLayout(database.db, root);
    files = new FilesService(
      {
        getStringSetting: (key: string) =>
          key === SECURITY_SETTING_KEYS.workspaceRoots ? root : '',
        getSetting: () => ({ value: '' }),
        onChange: () => () => {},
      } as unknown as SettingsService,
      database.db,
    );
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    files.onModuleDestroy();
    database.sqlite.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('creates a principal from the immutable generated ID and rejects custom primary paths', async () => {
    const prepare = layout.prepare.bind(layout) as (
      id: string,
    ) => Promise<string>;
    vi.spyOn(ProjectWorkspaceLayout.prototype, 'prepare').mockImplementation(
      (id) => prepare(id),
    );
    const service = new ProjectsService(
      files,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      database.db,
    );
    const project = await service.create('Renamable project');
    expect(project.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(project.workspacePath).toBe(path.join(root, project.id));
    expect(project.workspaceLayoutVersion).toBe(1);
    expect(
      await fs.stat(path.join(project.workspacePath, '.webui/history')),
    ).toMatchObject({});
    await expect(service.create('Custom', legacy)).rejects.toThrow(
      'generated from the project ID',
    );
  });

  it('recovers filesystem preparation completed before a database transaction', async () => {
    const primary = await layout.prepare('project-id');
    await fs.writeFile(
      path.join(primary, '.webui/knowledge/CONNAISSANCES.md'),
      'Preserved',
    );
    await layout.migrate();
    expect(
      database.db.select().from(projects).get()?.workspaceLayoutVersion,
    ).toBe(1);
    expect(
      await fs.readFile(
        path.join(primary, '.webui/knowledge/CONNAISSANCES.md'),
        'utf8',
      ),
    ).toBe('Preserved');
  });

  it('migrates once without moving files or changing active conversation workspaces', async () => {
    await layout.migrate();
    const primary = path.join(root, 'project-id');
    expect(database.db.select().from(projects).get()).toMatchObject({
      workspacePath: primary,
      workspaceLayoutVersion: 1,
    });
    expect(database.db.select().from(projectWorkspaces).all()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'legacy', path: legacy, primary: false }),
        expect.objectContaining({ path: primary, primary: true }),
      ]),
    );
    expect(
      database.db.select().from(projectAgentThreads).get()?.workspacePath,
    ).toBe(legacy);
    expect(database.db.select().from(simpleChatThreads).get()?.cwd).toBe(
      legacy,
    );
    expect(await fs.readFile(path.join(legacy, 'AGENTS.md'), 'utf8')).toBe(
      'Existing instructions',
    );
    await fs.writeFile(
      path.join(primary, '.webui/knowledge/DECISIONS.md'),
      'A decision',
    );
    await layout.migrate();
    expect(database.db.select().from(projectWorkspaces).all()).toHaveLength(2);
    expect(
      await fs.readFile(
        path.join(primary, '.webui/knowledge/DECISIONS.md'),
        'utf8',
      ),
    ).toBe('A decision');
  });

  it('does not adopt an unrelated directory or partially update project metadata', async () => {
    await fs.mkdir(path.join(root, 'project-id'));
    await fs.writeFile(path.join(root, 'project-id', 'user.txt'), 'Keep me');
    await expect(layout.migrate()).rejects.toThrow('ownership marker');
    expect(database.db.select().from(projects).get()?.workspacePath).toBe(
      legacy,
    );
    expect(database.db.select().from(projectWorkspaces).all()).toHaveLength(1);
    expect(
      await fs.readFile(path.join(root, 'project-id', 'user.txt'), 'utf8'),
    ).toBe('Keep me');
  });

  it('retains a missing migrated primary instead of silently creating or promoting one', async () => {
    await layout.migrate();
    await fs.rm(path.join(root, 'project-id'), { recursive: true });
    const service = new ProjectsService(
      files,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      database.db,
    );
    expect(await service.reconcileMissingWorkspaces()).toMatchObject({
      removed: [],
      unresolved: [path.join(root, 'project-id')],
    });
    await layout.migrate();
    await expect(fs.stat(path.join(root, 'project-id'))).rejects.toThrow();
    expect(
      database.db
        .select()
        .from(projectWorkspaces)
        .all()
        .find((w) => w.primary)?.path,
    ).toBe(path.join(root, 'project-id'));
  });

  it('preserves primary files when the project is deleted without a physical deletion selection', async () => {
    await layout.migrate();
    database.db.delete(projectAgentThreads).run();
    const service = new ProjectsService(
      files,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      database.db,
    );
    const result = await service.remove('project-id', 'My project');
    expect(result.deletedWorkspaces).toEqual([]);
    expect(result.preservedWorkspaces).toContain(path.join(root, 'project-id'));
    expect(database.db.select().from(projects).all()).toHaveLength(0);
    expect(
      await fs.stat(path.join(root, 'project-id', '.webui')),
    ).toMatchObject({});
  });

  it('allows explicit primary deletion only after confirmed project removal', async () => {
    await layout.migrate();
    database.db.delete(projectAgentThreads).run();
    const primary = database.db
      .select()
      .from(projectWorkspaces)
      .all()
      .find((w) => w.primary)!;
    const removeDirectory = vi
      .spyOn(files, 'deleteManagedWorkspace')
      .mockImplementation(async (target) => {
        expect(database.db.select().from(projects).all()).toHaveLength(0);
        expect(() => files.assertProjectPathMutable(target)).not.toThrow();
        await fs.rm(target, { recursive: true });
      });
    const service = new ProjectsService(
      files,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      database.db,
    );
    await expect(
      service.remove('project-id', 'Wrong name', [primary.id]),
    ).rejects.toThrow('confirmation');
    expect(removeDirectory).not.toHaveBeenCalled();
    expect(
      await service.remove('project-id', 'My project', [primary.id]),
    ).toMatchObject({
      deletedWorkspaces: [primary.path],
      preservedWorkspaces: [legacy],
    });
    await expect(fs.stat(primary.path)).rejects.toThrow();
    expect(await fs.readFile(path.join(legacy, 'AGENTS.md'), 'utf8')).toBe(
      'Existing instructions',
    );
  });

  it('protects primary roots, ancestors and system files while allowing ordinary content', async () => {
    await layout.migrate();
    const primary = path.join(root, 'project-id');
    await expect(files.deletePath(primary, true)).rejects.toThrow();
    await expect(
      files.movePath(primary, path.join(root, 'moved')),
    ).rejects.toThrow();
    await expect(files.renamePath(primary, 'renamed')).rejects.toThrow();
    await expect(
      files.writeFile(
        path.join(primary, '.webui/knowledge/DECISIONS.md'),
        'Overwrite',
      ),
    ).rejects.toThrow();
    expect(() => files.assertProjectPathMutable(root)).toThrow();
    await fs.symlink(primary, path.join(root, 'alias'));
    await expect(
      files.deletePath(path.join(root, 'alias'), true),
    ).rejects.toThrow();
    await files.writeFile(
      path.join(primary, 'documents', 'note.md'),
      'Allowed',
    );
    expect(
      await fs.readFile(path.join(primary, 'documents/note.md'), 'utf8'),
    ).toBe('Allowed');
  });

  it('rejects primary detachment and secondary promotion', async () => {
    await layout.migrate();
    const service = new ProjectsService(
      files,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      database.db,
    );
    const primary = database.db
      .select()
      .from(projectWorkspaces)
      .all()
      .find((w) => w.primary)!;
    await expect(
      service.detachWorkspace('project-id', primary.id),
    ).rejects.toThrow('only be removed with its project');
    expect(() => service.setDefaultWorkspace('project-id', 'legacy')).toThrow(
      'permanent',
    );
    service.rename('project-id', 'New display name');
    expect(database.db.select().from(projects).get()?.workspacePath).toBe(
      primary.path,
    );
  });
});
