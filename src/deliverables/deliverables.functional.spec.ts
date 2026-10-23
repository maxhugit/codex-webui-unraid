import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  people,
  projectParticipants,
  projectPersonGroupMembers,
  projectPersonGroups,
  projectResources,
  projects,
  projectTasks,
  projectTaskStatuses,
  projectWorkspaces,
} from '../database/schema';
import {
  createTestDatabase,
  type TestDatabase,
} from '../database/database.testing';
import { FilesService } from '../files/files.service';
import type { SettingsService } from '../settings/settings.service';
import { SECURITY_SETTING_KEYS } from '../settings/settings.definitions';
import { IdentityService } from '../auth/identity.service';
import { DeliverablesService } from './deliverables.service';

describe('deliverables functional workflows', () => {
  let database: TestDatabase;
  let root: string;
  let service: DeliverablesService;

  beforeEach(async () => {
    database = createTestDatabase();
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'deliverables-functional-'));
    await fs.mkdir(path.join(root, '.webui'));
    const now = Date.now();
    database.db
      .insert(projects)
      .values({
        id: 'project',
        name: 'Functional project',
        workspacePath: root,
        workspaceLayoutVersion: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.db
      .insert(projectWorkspaces)
      .values({
        id: 'workspace',
        projectId: 'project',
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
        id: 'deliverables',
        projectId: 'project',
        name: 'Deliverables',
        type: 'deliverable_board',
        config: {},
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const files = new FilesService(
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

  it('runs the complete document lifecycle without a task manager', async () => {
    let deliverable = await service.create('project', 'deliverables', {
      title: 'Design package',
      description: 'A self-contained document library',
    });
    expect(service.board('project', 'deliverables').taskManagers).toEqual([]);
    expect(deliverable).toMatchObject({
      lifecycleStatus: 'draft',
      primaryTaskId: null,
      validationStatus: 'not_required',
    });

    const brief = path.join(root, 'livrables', deliverable.id, 'brief.docx');
    const budget = path.join(root, 'livrables', deliverable.id, 'budget.xlsx');
    await fs.writeFile(brief, 'Brief V1');
    await fs.writeFile(budget, 'Budget V1');
    await service.addDocumentVersion(
      'project',
      'deliverables',
      deliverable.id,
      { path: brief, comment: 'Initial brief' },
      { personId: null, name: 'Alice' },
    );
    await service.addDocumentVersion(
      'project',
      'deliverables',
      deliverable.id,
      { path: budget, comment: 'Initial budget' },
      { personId: null, name: 'Alice' },
    );
    let boardDeliverable = service
      .board('project', 'deliverables')
      .deliverables.find((candidate) => candidate.id === deliverable.id)!;
    expect(boardDeliverable).toMatchObject({
      lifecycleStatus: 'in_constitution',
      version: 3,
    });
    expect(boardDeliverable.documents).toHaveLength(2);

    const briefDocument = boardDeliverable.documents.find(
      (document) => document.name === 'brief.docx',
    )!;
    await fs.writeFile(brief, 'Brief V2');
    await service.addDocumentVersion(
      'project',
      'deliverables',
      deliverable.id,
      { path: brief, expectedVersion: 1, comment: 'Reviewed brief' },
      { personId: null, name: 'Alice' },
      briefDocument.id,
    );
    boardDeliverable = service
      .board('project', 'deliverables')
      .deliverables.find((candidate) => candidate.id === deliverable.id)!;
    expect(
      boardDeliverable.documents.find(
        (document) => document.id === briefDocument.id,
      ),
    ).toMatchObject({ currentVersionNumber: 2 });

    deliverable = service.transitionLifecycle(
      'project',
      'deliverables',
      deliverable.id,
      { target: 'finalized', version: boardDeliverable.version },
    );
    expect(deliverable).toMatchObject({
      lifecycleStatus: 'finalized',
      validationStatus: 'not_required',
    });
    const finalizedSnapshot = deliverable.currentSnapshotId;
    boardDeliverable = service
      .board('project', 'deliverables')
      .deliverables.find((candidate) => candidate.id === deliverable.id)!;
    expect(boardDeliverable.snapshots.at(-1)?.documents).toHaveLength(2);

    deliverable = service.transitionLifecycle(
      'project',
      'deliverables',
      deliverable.id,
      { target: 'archived', version: deliverable.version },
    );
    expect(deliverable.lifecycleStatus).toBe('archived');
    await expect(
      service.addDocumentVersion(
        'project',
        'deliverables',
        deliverable.id,
        { path: brief, expectedVersion: 2 },
        { personId: null, name: 'Alice' },
        briefDocument.id,
      ),
    ).rejects.toThrow('Reopen');

    deliverable = service.transitionLifecycle(
      'project',
      'deliverables',
      deliverable.id,
      { target: 'finalized', version: deliverable.version },
    );
    deliverable = service.transitionLifecycle(
      'project',
      'deliverables',
      deliverable.id,
      { target: 'in_constitution', version: deliverable.version },
    );
    boardDeliverable = service
      .board('project', 'deliverables')
      .deliverables.find((candidate) => candidate.id === deliverable.id)!;
    expect(boardDeliverable.currentSnapshotId).toBe(finalizedSnapshot);
    expect(boardDeliverable.documents).toHaveLength(2);
  });

  it('runs a restricted task-backed rejection, rework and approval workflow', async () => {
    const now = Date.now();
    database.db
      .insert(projectResources)
      .values({
        id: 'tasks',
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
        title: 'Produce the design package',
        position: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    for (const person of ['author', 'reviewer']) {
      database.db
        .insert(people)
        .values({
          id: person,
          reference: person,
          name: person,
          email: `${person}@example.com`,
          identitySubject: person,
          role: 'standard',
          active: true,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      database.db
        .insert(projectParticipants)
        .values({
          projectId: 'project',
          personId: person,
          createdAt: now,
        })
        .run();
    }
    database.db
      .insert(projectPersonGroups)
      .values({
        id: 'reviewers',
        projectId: 'project',
        name: 'Reviewers',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    database.db
      .insert(projectPersonGroupMembers)
      .values({
        groupId: 'reviewers',
        personId: 'reviewer',
        createdAt: now,
      })
      .run();

    let deliverable = await service.create('project', 'deliverables', {
      title: 'Restricted design package',
      confidentiality: 'restricted',
      authorizedGroupIds: ['reviewers'],
      primaryTaskId: 'main-task',
    });
    const documentPath = path.join(
      root,
      'livrables',
      deliverable.id,
      'architecture.docx',
    );
    await fs.writeFile(documentPath, 'Architecture V1');
    await service.addDocumentVersion(
      'project',
      'deliverables',
      deliverable.id,
      { path: documentPath },
      { personId: 'author', name: 'Author' },
    );
    deliverable = service.get('project', 'deliverables', deliverable.id);
    deliverable = service.setValidationRequirement(
      'project',
      'deliverables',
      deliverable.id,
      { required: true, version: deliverable.version },
      { personId: 'author', name: 'Author' },
    );
    deliverable = service.transitionLifecycle(
      'project',
      'deliverables',
      deliverable.id,
      {
        target: 'finalized',
        version: service.get('project', 'deliverables', deliverable.id).version,
      },
    );
    const firstRequest = service.requestValidation(
      'project',
      'deliverables',
      deliverable.id,
      { version: deliverable.version },
      { personId: 'author', name: 'Author' },
    );
    deliverable = service.get('project', 'deliverables', deliverable.id);
    service.decideValidation(
      'project',
      'deliverables',
      deliverable.id,
      firstRequest.id,
      {
        action: 'reject',
        comment: 'The security section is incomplete',
        version: deliverable.version,
      },
      { personId: 'reviewer', name: 'Reviewer' },
    );
    deliverable = service.get('project', 'deliverables', deliverable.id);
    expect(deliverable).toMatchObject({
      validationStatus: 'rejected',
      primaryTaskId: 'main-task',
      confidentiality: 'restricted',
    });

    deliverable = service.transitionLifecycle(
      'project',
      'deliverables',
      deliverable.id,
      { target: 'in_constitution', version: deliverable.version },
    );
    let boardDeliverable = service
      .board('project', 'deliverables')
      .deliverables.find((candidate) => candidate.id === deliverable.id)!;
    const document = boardDeliverable.documents[0];
    await fs.writeFile(documentPath, 'Architecture V2 with security');
    await service.addDocumentVersion(
      'project',
      'deliverables',
      deliverable.id,
      {
        path: documentPath,
        expectedVersion: document.currentVersionNumber,
        comment: 'Security section completed',
      },
      { personId: 'author', name: 'Author' },
      document.id,
    );
    boardDeliverable = service
      .board('project', 'deliverables')
      .deliverables.find((candidate) => candidate.id === deliverable.id)!;
    deliverable = service.transitionLifecycle(
      'project',
      'deliverables',
      deliverable.id,
      { target: 'finalized', version: boardDeliverable.version },
    );
    const secondRequest = service.requestValidation(
      'project',
      'deliverables',
      deliverable.id,
      { version: deliverable.version },
      { personId: 'author', name: 'Author' },
    );
    deliverable = service.get('project', 'deliverables', deliverable.id);
    service.decideValidation(
      'project',
      'deliverables',
      deliverable.id,
      secondRequest.id,
      {
        action: 'approve',
        comment: 'Approved after rework',
        version: deliverable.version,
      },
      { personId: 'reviewer', name: 'Reviewer' },
    );

    boardDeliverable = service
      .board('project', 'deliverables')
      .deliverables.find((candidate) => candidate.id === deliverable.id)!;
    expect(boardDeliverable).toMatchObject({
      lifecycleStatus: 'finalized',
      validationStatus: 'approved',
      status: 'validated',
      lastApprovedSnapshotId: boardDeliverable.currentSnapshotId,
    });
    expect(boardDeliverable.validations.map((entry) => entry.status)).toEqual([
      'approved',
      'rejected',
    ]);
    expect(boardDeliverable.documents[0]).toMatchObject({
      currentVersionNumber: 2,
    });
    expect(boardDeliverable.authorizedGroupIds).toEqual(['reviewers']);
  });
});
