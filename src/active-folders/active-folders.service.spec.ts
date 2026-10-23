import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import {
  createTestDatabase,
  type TestDatabase,
} from '../database/database.testing';
import {
  projectActiveFolders,
  projectAgentThreads,
  projectResources,
  projects,
  projectTasks,
  projectTaskStatuses,
  projectWorkspaces,
} from '../database/schema';
import { ActiveFoldersService } from './active-folders.service';

describe('active folders', () => {
  let database: TestDatabase;
  let root: string;
  let primary: string;
  let secondary: string;
  let service: ActiveFoldersService;

  beforeEach(async () => {
    database = createTestDatabase();
    root = await fsp.mkdtemp(path.join(os.tmpdir(), 'active-folders-'));
    primary = path.join(root, 'primary');
    secondary = path.join(root, 'secondary');
    await fsp.mkdir(path.join(primary, 'documents', 'plans'), {
      recursive: true,
    });
    await fsp.mkdir(path.join(secondary, 'source'), { recursive: true });
    const now = Date.now();
    database.db
      .insert(projects)
      .values({
        id: 'project',
        name: 'Project',
        workspacePath: primary,
        workspaceLayoutVersion: 2,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.db
      .insert(projectWorkspaces)
      .values([
        {
          id: 'primary',
          projectId: 'project',
          name: 'Principal',
          path: primary,
          primary: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'secondary',
          projectId: 'project',
          name: 'Sources',
          path: secondary,
          primary: false,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();
    database.db
      .insert(projectAgentThreads)
      .values({
        threadId: 'agent',
        projectId: 'project',
        workspacePath: primary,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    service = new ActiveFoldersService(database.db);
  });

  afterEach(async () => {
    database.sqlite.close();
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('stores a stable resource and confined relative path', () => {
    expect(
      service.set('project', 'agent', 'agent', {
        resourceId: 'primary',
        relativePath: 'documents/plans',
      }),
    ).toMatchObject({
      resourceId: 'primary',
      relativePath: 'documents/plans',
      effectivePath: path.join(primary, 'documents', 'plans'),
      state: 'ready',
    });
    expect(() =>
      service.set('project', 'agent', 'agent', {
        resourceId: 'primary',
        relativePath: '../secondary',
      }),
    ).toThrow('cannot leave');
  });

  it('refuses contexts and resources owned by another project', async () => {
    const otherRoot = path.join(root, 'other');
    await fsp.mkdir(otherRoot);
    const now = Date.now();
    database.db
      .insert(projects)
      .values({
        id: 'other-project',
        name: 'Other',
        workspacePath: otherRoot,
        workspaceLayoutVersion: 2,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.db
      .insert(projectWorkspaces)
      .values({
        id: 'other-primary',
        projectId: 'other-project',
        name: 'Principal',
        path: otherRoot,
        primary: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    expect(() =>
      service.set('project', 'agent', 'agent', {
        resourceId: 'other-primary',
      }),
    ).toThrow('not found');
    expect(() =>
      service.set('other-project', 'agent', 'agent', {
        resourceId: 'other-primary',
      }),
    ).toThrow('another project');
  });

  it('keeps a detached reference unresolved without falling back', () => {
    service.set('project', 'agent', 'agent', {
      resourceId: 'secondary',
      relativePath: 'source',
    });
    database.db
      .delete(projectWorkspaces)
      .where(eq(projectWorkspaces.id, 'secondary'))
      .run();
    expect(service.get('agent', 'agent')).toMatchObject({
      resourceId: 'secondary',
      state: 'detached',
      effectivePath: null,
    });
    expect(() => service.resolve('agent', 'agent')).toThrow('unresolved');
  });

  it('uses a linked task folder before the agent default', () => {
    const now = Date.now();
    database.db
      .insert(projectResources)
      .values({
        id: 'board',
        projectId: 'project',
        name: 'Tasks',
        type: 'task_board',
        config: {},
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.db
      .insert(projectTaskStatuses)
      .values({
        id: 'status',
        resourceId: 'board',
        name: 'Todo',
        color: '#000000',
        kind: 'unassigned',
        position: 0,
        system: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.db
      .insert(projectTasks)
      .values({
        id: 'task',
        resourceId: 'board',
        statusId: 'status',
        title: 'Task',
        linkedThreadId: 'agent',
        position: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    service.set('project', 'agent', 'agent', {
      resourceId: 'primary',
      relativePath: '',
    });
    service.set('project', 'task', 'task', {
      resourceId: 'secondary',
      relativePath: 'source',
    });
    expect(service.resolveAgent('agent')).toBe(path.join(secondary, 'source'));
  });

  it('migrates nested absolute legacy paths without changing them', () => {
    database.db
      .update(projectAgentThreads)
      .set({ workspacePath: path.join(primary, 'documents', 'plans') })
      .run();
    service.migrateLegacyReferences();
    expect(database.db.select().from(projectActiveFolders).get()).toMatchObject(
      {
        contextType: 'agent',
        contextId: 'agent',
        resourceId: 'primary',
        relativePath: 'documents/plans',
      },
    );
  });

  it('reports symlink escapes as invalid', async () => {
    const outside = path.join(root, 'outside');
    await fsp.mkdir(outside);
    fs.symlinkSync(outside, path.join(primary, 'escape'));
    database.db
      .insert(projectActiveFolders)
      .values({
        contextType: 'agent',
        contextId: 'agent',
        projectId: 'project',
        resourceId: 'primary',
        relativePath: 'escape',
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    expect(service.get('agent', 'agent')?.state).toBe('invalid');
  });
});
