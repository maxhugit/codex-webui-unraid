import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createTestDatabase,
  type TestDatabase,
} from '../database/database.testing';
import {
  projects,
  projectResources,
  projectWorkspaces,
  projectAgentThreads,
} from '../database/schema';
import { DeliverablesService } from './deliverables.service';
import { FilesService } from '../files/files.service';
import type { SettingsService } from '../settings/settings.service';
import { SECURITY_SETTING_KEYS } from '../settings/settings.definitions';
import { ProjectsService } from '../projects/projects.service';
import { IdentityService } from '../auth/identity.service';

describe('project deliverables', () => {
  let database: TestDatabase,
    root: string,
    service: DeliverablesService,
    files: FilesService;
  beforeEach(async () => {
    database = createTestDatabase();
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'deliverables-'));
    await fs.mkdir(path.join(root, '.webui'));
    const now = Date.now();
    database.db
      .insert(projects)
      .values({
        id: 'p',
        name: 'Project',
        workspacePath: root,
        workspaceLayoutVersion: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.db
      .insert(projectWorkspaces)
      .values({
        id: 'w',
        projectId: 'p',
        name: 'Primary',
        path: root,
        primary: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.db
      .insert(projectResources)
      .values({
        id: 'r',
        projectId: 'p',
        name: 'Deliverables',
        type: 'deliverable_board',
        config: {},
        createdAt: now,
        updatedAt: now,
      })
      .run();
    files = new FilesService(
      {
        getStringSetting: (key: string) =>
          key === SECURITY_SETTING_KEYS.workspaceRoots ? root : '',
        getSetting: () => ({ value: '' }),
        onChange: () => () => {},
      } as unknown as SettingsService,
      database.db,
    );
    service = new DeliverablesService(
      database.db,
      files,
      new IdentityService(database.db),
    );
  });
  afterEach(async () => {
    database.sqlite.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  it('preserves validated snapshots while a later version is prepared and leaves files on removal', async () => {
    const item = await service.create('p', 'r', {
      title: 'Report',
      criteria: 'Readable',
    });
    const source = path.join(root, 'livrables', item.id, 'report.txt');
    await fs.writeFile(source, 'First');
    const first = await service.submit('p', 'r', item.id, {
      paths: [source],
      version: 1,
    });
    expect(first.status).toBe('proposed');
    await fs.writeFile(source, 'Next');
    expect(
      await fs.readFile(
        (await service.file('p', 'r', item.id, first.id, 0)).snapshotPath,
        'utf8',
      ),
    ).toBe('First');
    await service.review(
      'p',
      'r',
      item.id,
      first.id,
      { action: 'validate', version: 2 },
      'Alice',
    );
    const second = await service.submit('p', 'r', item.id, {
      paths: [source],
      version: 3,
    });
    expect(service.get('p', 'r', item.id).validatedVersionId).toBe(first.id);
    expect(second.number).toBe(2);
    expect(() =>
      service.update('p', 'r', item.id, { title: 'Stale', version: 1 }),
    ).toThrow('Reload');
    service.remove('p', 'r', item.id, 4);
    expect(await fs.readFile(first.files[0].snapshotPath, 'utf8')).toBe(
      'First',
    );
    expect(await fs.readFile(source, 'utf8')).toBe('Next');
    expect(database.sqlite.pragma('foreign_key_check')).toEqual([]);
  });
  it('rejects forged validation, out-of-project links, system files and tampered snapshots', async () => {
    await expect(
      service.create('p', 'r', { title: 'Forged', status: 'validated' }),
    ).rejects.toThrow('Validate a submitted');
    await expect(
      service.create('p', 'r', { title: 'Other', taskIds: ['foreign'] }),
    ).rejects.toThrow('belong to this project');
    await expect(
      service.create('p', 'r', { title: 'Other', assigneeId: 'foreign' }),
    ).rejects.toThrow('active project participant');
    const item = await service.create('p', 'r', { title: 'Output' });
    const secret = path.join(root, '.webui', 'secret.txt');
    await fs.writeFile(secret, 'Secret');
    await expect(
      service.submit('p', 'r', item.id, { paths: [secret], version: 1 }),
    ).rejects.toThrow();
    const source = path.join(root, 'file.txt');
    await fs.writeFile(source, 'Original');
    const version = await service.submit('p', 'r', item.id, {
      paths: [source],
      version: 1,
    });
    await fs.writeFile(version.files[0].snapshotPath, 'Tampered');
    await expect(
      service.review(
        'p',
        'r',
        item.id,
        version.id,
        { action: 'validate', version: 2 },
        'Bob',
      ),
    ).rejects.toThrow('modified');
    expect(service.get('p', 'r', item.id).validatedVersionId).toBeNull();
    await expect(
      service.file('p', 'r', item.id, version.id, 0),
    ).rejects.toThrow('modified');
    expect(() => service.get('other', 'r', item.id)).toThrow('not found');
  });
  it('injects the brief only into linked project conversations', async () => {
    const now = Date.now();
    database.db
      .insert(projectAgentThreads)
      .values({
        threadId: 'agent',
        projectId: 'p',
        workspacePath: root,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const item = await service.create('p', 'r', {
      title: 'My brief',
      criteria: 'Checked',
      conversations: [{ type: 'agent', id: 'agent' }],
    });
    expect(service.contextForConversation('agent')).toContain('My brief');
    expect(service.contextForConversation('agent')).toContain(
      path.join(root, 'livrables', item.id),
    );
    expect(service.contextForConversation('unrelated')).toBeNull();
    const updated = service.update('p', 'r', item.id, {
      title: 'Renamed',
      version: 1,
    });
    expect(service.board('p', 'r').deliverables[0].directory).toBe(
      path.join(root, 'livrables', updated.id),
    );
  });
  it('returns existing optional managers and enforces singleton inserts in SQLite', () => {
    const projectsService = new ProjectsService(
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      null as never,
      database.db,
    );
    expect(
      projectsService.createResource('p', { type: 'deliverable_board' }).id,
    ).toBe('r');
    const first = projectsService.createResource('p', {
      type: 'automation_board',
    });
    expect(
      projectsService.createResource('p', { type: 'automation_board' }).id,
    ).toBe(first.id);
    expect(() =>
      database.db
        .insert(projectResources)
        .values({
          id: 'duplicate',
          projectId: 'p',
          name: 'Duplicate',
          type: 'automation_board',
          config: {},
          createdAt: 1,
          updatedAt: 1,
        })
        .run(),
    ).toThrow('single_project_manager');
    expect(database.db.select().from(projectResources).all()).toHaveLength(2);
  });
  it('installs singleton constraints over legacy duplicates without deleting their content', async () => {
    database.sqlite.exec(
      'DROP TRIGGER single_project_manager_insert; DROP TRIGGER single_project_manager_move;',
    );
    for (const id of ['legacy-a', 'legacy-b'])
      database.db
        .insert(projectResources)
        .values({
          id,
          projectId: 'p',
          type: 'automation_board',
          name: id,
          config: { automations: [{ id }] },
          createdAt: 1,
          updatedAt: 1,
        })
        .run();
    const migration = await fs.readFile(
      path.join(process.cwd(), 'drizzle/0032_project_deliverables.sql'),
      'utf8',
    );
    database.sqlite.exec(
      migration
        .slice(migration.indexOf('CREATE TRIGGER'))
        .replaceAll('--> statement-breakpoint', ''),
    );
    const legacy = database.db
      .select()
      .from(projectResources)
      .all()
      .filter((r) => r.type === 'automation_board');
    expect(legacy).toHaveLength(2);
    expect(legacy[1].config).toEqual({ automations: [{ id: 'legacy-b' }] });
    expect(() =>
      database.sqlite
        .prepare(
          "INSERT INTO project_resources (id,project_id,type,name,config,created_at,updated_at) VALUES ('third','p','automation_board','Third','{}',1,1)",
        )
        .run(),
    ).toThrow('single_project_manager');
    expect(() =>
      database.sqlite
        .prepare(
          "UPDATE project_resources SET name='Renamed' WHERE id='legacy-a'",
        )
        .run(),
    ).not.toThrow();
  });
  it('rejects symlink escapes and paths outside attached project workspaces', async () => {
    const item = await service.create('p', 'r', { title: 'Output' });
    const foreign = await fs.mkdtemp(
      path.join(os.tmpdir(), 'foreign-deliverables-'),
    );
    try {
      const source = path.join(foreign, 'file.txt');
      await fs.writeFile(source, 'Foreign');
      await fs.symlink(source, path.join(root, 'escape.txt'));
      await expect(
        service.submit('p', 'r', item.id, { paths: [source], version: 1 }),
      ).rejects.toThrow();
      await expect(
        service.submit('p', 'r', item.id, {
          paths: [path.join(root, 'escape.txt')],
          version: 1,
        }),
      ).rejects.toThrow();
      expect(service.get('p', 'r', item.id).version).toBe(1);
    } finally {
      await fs.rm(foreign, { recursive: true, force: true });
    }
  });
  it('registers an agent in the primary workspace and rolls back stale associations', async () => {
    const item = await service.create('p', 'r', {
      title: 'Agent output',
      criteria: 'Publishable',
    });
    expect(service.agentWorkspace('p', 'r', item.id, 1)).toBe(root);
    service.registerAgent('p', 'r', item.id, 1, 'new-agent');
    expect(service.contextForConversation('new-agent')).toContain(
      'Publishable',
    );
    expect(() =>
      service.registerAgent('p', 'r', item.id, 1, 'stale-agent'),
    ).toThrow('changed');
    expect(service.contextForConversation('stale-agent')).toBeNull();
  });
});
