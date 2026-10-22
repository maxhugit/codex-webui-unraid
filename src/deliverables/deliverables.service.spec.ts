import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import {
  createTestDatabase,
  type TestDatabase,
} from '../database/database.testing';
import {
  projects,
  projectResources,
  projectWorkspaces,
  projectAgentThreads,
  projectTasks,
  projectTaskStatuses,
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
  it('associates one main task from the project and clears it when the task is deleted', async () => {
    const now = Date.now();
    database.db
      .insert(projectResources)
      .values({
        id: 'tasks',
        projectId: 'p',
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
        id: 'todo',
        resourceId: 'tasks',
        name: 'To do',
        color: 'slate',
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
        id: 'main-task',
        resourceId: 'tasks',
        statusId: 'todo',
        title: 'Main task',
        position: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const item = await service.create('p', 'r', {
      title: 'Linked',
      primaryTaskId: 'main-task',
    });
    expect(item.primaryTaskId).toBe('main-task');
    expect(service.board('p', 'r').tasks[0]).toMatchObject({
      id: 'main-task',
      status: 'To do',
      parentTaskId: null,
    });
    expect(service.board('p', 'r').taskManagers).toEqual([
      { id: 'tasks', name: 'Tasks' },
    ]);
    database.db
      .delete(projectTasks)
      .where(eq(projectTasks.id, 'main-task'))
      .run();
    expect(service.get('p', 'r', item.id).primaryTaskId).toBeNull();
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
  it('versions every document independently and restores history as a new version', async () => {
    const item = await service.create('p', 'r', { title: 'Document set' });
    const report = path.join(root, 'livrables', item.id, 'report.docx');
    const sheet = path.join(root, 'livrables', item.id, 'budget.xlsx');
    await fs.writeFile(report, 'Report V1');
    await service.addDocumentVersion(
      'p',
      'r',
      item.id,
      { path: report, comment: 'Initial report' },
      { personId: null, name: 'Alice' },
    );
    await fs.writeFile(sheet, 'Budget V1');
    await service.addDocumentVersion(
      'p',
      'r',
      item.id,
      { path: sheet },
      { personId: null, name: 'Bob' },
    );
    let documents = service.documents('p', 'r', item.id);
    const reportDocument = documents.find(
      (document) => document.name === 'report.docx',
    )!;
    const sheetDocument = documents.find(
      (document) => document.name === 'budget.xlsx',
    )!;
    expect(reportDocument.currentVersionNumber).toBe(1);
    expect(sheetDocument.currentVersionNumber).toBe(1);
    expect(reportDocument.versions[0].authorName).toBe('Alice');

    await fs.writeFile(report, 'Report V2');
    await service.addDocumentVersion(
      'p',
      'r',
      item.id,
      { path: report, expectedVersion: 1, comment: 'Reworked' },
      { personId: null, name: 'Alice' },
      reportDocument.id,
    );
    documents = service.documents('p', 'r', item.id);
    expect(
      documents.find((document) => document.id === reportDocument.id)?.versions,
    ).toHaveLength(2);
    expect(
      documents.find((document) => document.id === sheetDocument.id)?.versions,
    ).toHaveLength(1);
    await expect(
      service.addDocumentVersion(
        'p',
        'r',
        item.id,
        { path: report, expectedVersion: 2 },
        { personId: null, name: 'Alice' },
        reportDocument.id,
      ),
    ).rejects.toThrow('has not changed');

    const firstVersion = documents
      .find((document) => document.id === reportDocument.id)!
      .versions.find((version) => version.number === 1)!;
    await service.restoreDocumentVersion(
      'p',
      'r',
      item.id,
      reportDocument.id,
      firstVersion.id,
      { expectedVersion: 2 },
      { personId: null, name: 'Alice' },
    );
    expect(await fs.readFile(report, 'utf8')).toBe('Report V1');
    expect(
      service
        .documents('p', 'r', item.id)
        .find((document) => document.id === reportDocument.id),
    ).toMatchObject({ currentVersionNumber: 3, deletedAt: null });
    service.setDocumentDeleted('p', 'r', item.id, reportDocument.id, 3, true);
    expect(
      service
        .documents('p', 'r', item.id)
        .find((document) => document.id === reportDocument.id)?.deletedAt,
    ).toEqual(expect.any(Number));
    service.setDocumentDeleted('p', 'r', item.id, reportDocument.id, 3, false);
    expect(
      service
        .documents('p', 'r', item.id)
        .find((document) => document.id === reportDocument.id)?.deletedAt,
    ).toBeNull();
  });
  it('validates an immutable snapshot and marks pending requests outdated after document changes', async () => {
    const item = await service.create('p', 'r', { title: 'Approval pack' });
    const source = path.join(root, 'livrables', item.id, 'report.docx');
    await fs.writeFile(source, 'Version 1');
    await service.addDocumentVersion(
      'p',
      'r',
      item.id,
      { path: source },
      { personId: null, name: 'Alice' },
    );
    const firstRequest = service.requestValidation(
      'p',
      'r',
      item.id,
      { version: 2 },
      { personId: null, name: 'Alice' },
    );
    expect(
      service.board('p', 'r').deliverables[0].validations[0],
    ).toMatchObject({ id: firstRequest.id, effectiveStatus: 'pending' });

    const document = service.documents('p', 'r', item.id)[0];
    await fs.writeFile(source, 'Version 2');
    await service.addDocumentVersion(
      'p',
      'r',
      item.id,
      { path: source, expectedVersion: 1 },
      { personId: null, name: 'Alice' },
      document.id,
    );
    expect(
      service.board('p', 'r').deliverables[0].validations[0].effectiveStatus,
    ).toBe('outdated');
    expect(() =>
      service.decideValidation(
        'p',
        'r',
        item.id,
        firstRequest.id,
        { action: 'approve', version: 4 },
        { personId: null, name: 'Bob' },
      ),
    ).toThrow('outdated');

    const secondRequest = service.requestValidation(
      'p',
      'r',
      item.id,
      { version: 4 },
      { personId: null, name: 'Alice' },
    );
    expect(() =>
      service.decideValidation(
        'p',
        'r',
        item.id,
        secondRequest.id,
        { action: 'reject', version: 5 },
        { personId: null, name: 'Bob' },
      ),
    ).toThrow('reason');
    const decision = service.decideValidation(
      'p',
      'r',
      item.id,
      secondRequest.id,
      { action: 'approve', comment: 'Conforme', version: 5 },
      { personId: null, name: 'Bob' },
    );
    expect(decision).toMatchObject({
      status: 'approved',
      decidedByName: 'Bob',
      decisionComment: 'Conforme',
    });
    expect(service.get('p', 'r', item.id).status).toBe('validated');
  });
  it('enforces the deliverable lifecycle and preserves immutable finalization snapshots', async () => {
    const item = await service.create('p', 'r', { title: 'Lifecycle' });
    expect(item.lifecycleStatus).toBe('draft');
    expect(() =>
      service.transitionLifecycle('p', 'r', item.id, {
        target: 'finalized',
        version: 1,
      }),
    ).toThrow('at least one document');

    const source = path.join(root, 'livrables', item.id, 'report.docx');
    await fs.writeFile(source, 'Version 1');
    await service.addDocumentVersion(
      'p',
      'r',
      item.id,
      { path: source },
      { personId: null, name: 'Alice' },
    );
    expect(service.get('p', 'r', item.id)).toMatchObject({
      lifecycleStatus: 'in_constitution',
      version: 2,
    });

    const finalized = service.transitionLifecycle('p', 'r', item.id, {
      target: 'finalized',
      version: 2,
    });
    expect(finalized).toMatchObject({
      lifecycleStatus: 'finalized',
      version: 3,
      finalizedByName: 'System',
    });
    expect(finalized.currentSnapshotId).toEqual(expect.any(String));
    const board = service.board('p', 'r').deliverables[0];
    expect(board.snapshots).toHaveLength(1);
    expect(board.snapshots[0].documents).toEqual([
      expect.objectContaining({ versionNumber: 1 }),
    ]);

    await fs.writeFile(source, 'Version 2');
    await expect(
      service.addDocumentVersion(
        'p',
        'r',
        item.id,
        { path: source, expectedVersion: 1 },
        { personId: null, name: 'Alice' },
        board.documents[0].id,
      ),
    ).rejects.toThrow('Reopen');

    const archived = service.transitionLifecycle('p', 'r', item.id, {
      target: 'archived',
      version: 3,
    });
    expect(archived.lifecycleStatus).toBe('archived');
    expect(() =>
      service.update('p', 'r', item.id, { title: 'Forbidden', version: 4 }),
    ).toThrow('read-only');
    expect(() =>
      service.transitionLifecycle('p', 'r', item.id, {
        target: 'in_constitution',
        version: 4,
      }),
    ).toThrow('Invalid deliverable lifecycle transition');

    const unarchived = service.transitionLifecycle('p', 'r', item.id, {
      target: 'finalized',
      version: 4,
    });
    const reopened = service.transitionLifecycle('p', 'r', item.id, {
      target: 'in_constitution',
      version: unarchived.version,
    });
    expect(reopened.lifecycleStatus).toBe('in_constitution');
    expect(
      service.board('p', 'r').deliverables[0].lifecycleEvents,
    ).toHaveLength(6);
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
