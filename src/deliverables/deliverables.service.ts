import { requireProjectAccess, currentAccess } from '../auth/access-context';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import * as path from 'node:path';
import { DRIZZLE_DB, type AppDatabase } from '../database/database.constants';
import {
  projects,
  projectResources,
  projectDeliverables as items,
  projectDeliverableVersions as versions,
  projectDeliverableDocuments as documents,
  projectDeliverableDocumentVersions as documentVersions,
  projectDeliverableSnapshots as snapshots,
  projectDeliverableLifecycleEvents as lifecycleEvents,
  projectWorkspaces,
  projectParticipants,
  people,
  projectTasks,
  projectTaskStatuses,
  projectAgentThreads,
  simpleChatThreads,
  type DeliverableFile,
  type DeliverableSnapshotDocument,
} from '../database/schema';
import { FilesService } from '../files/files.service';
import { IdentityService } from '../auth/identity.service';

type Item = typeof items.$inferSelect;
export type DeliverableLifecycleStatus =
  | 'draft'
  | 'in_constitution'
  | 'finalized'
  | 'archived';
export interface DeliverableInput {
  title?: string;
  description?: string;
  criteria?: string;
  assigneeId?: string | null;
  dueAt?: number | null;
  status?: string;
  taskIds?: string[];
  primaryTaskId?: string | null;
  conversations?: Array<{ type: 'agent' | 'simple'; id: string }>;
  version?: number;
}
export interface DeliverableDocumentActor {
  personId: string | null;
  name: string;
}

const LIFECYCLE_TRANSITIONS: Record<
  DeliverableLifecycleStatus,
  DeliverableLifecycleStatus[]
> = {
  draft: ['in_constitution', 'finalized'],
  in_constitution: ['draft', 'finalized'],
  finalized: ['in_constitution', 'archived'],
  archived: ['finalized'],
};
const MAX_FILE = 100 * 1024 * 1024;

@Injectable()
export class DeliverablesService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: AppDatabase,
    private readonly files: FilesService,
    private readonly identities: IdentityService,
  ) {}
  contextForConversation(
    threadId: string,
    type: 'agent' | 'simple' = 'agent',
  ): string | null {
    const projectId =
      type === 'agent'
        ? this.db
            .select()
            .from(projectAgentThreads)
            .where(eq(projectAgentThreads.threadId, threadId))
            .get()?.projectId
        : this.db
            .select()
            .from(simpleChatThreads)
            .where(eq(simpleChatThreads.id, threadId))
            .get()?.projectId;
    if (!projectId) return null;
    const linked = this.db
      .select({
        id: items.id,
        title: items.title,
        description: items.description,
        criteria: items.criteria,
        status: items.status,
        workspace: projects.workspacePath,
        validatedVersionId: items.validatedVersionId,
      })
      .from(items)
      .innerJoin(projectResources, eq(items.resourceId, projectResources.id))
      .innerJoin(projects, eq(projectResources.projectId, projects.id))
      .where(
        and(
          eq(projects.id, projectId),
          sql`exists (select 1 from json_each(${items.conversations}) where json_extract(value, '$.id') = ${threadId} and json_extract(value, '$.type') = ${type})`,
        ),
      )
      .all();
    return linked.length
      ? '<project_deliverable_context>\nProject deliverables linked to this conversation. Use their goals and validation criteria. Save working files in the indicated directory. Do not claim validation; only a person can validate a submitted version.\n' +
          JSON.stringify(
            linked.map((item) => ({
              ...item,
              directory: path.join(item.workspace, 'livrables', item.id),
            })),
          ) +
          '\n</project_deliverable_context>'
      : null;
  }
  agentWorkspace(
    projectId: string,
    resourceId: string,
    id: string,
    version: number,
  ) {
    if (this.get(projectId, resourceId, id).version !== version)
      throw new ConflictException('Deliverable changed');
    return this.resource(projectId, resourceId).project.workspacePath;
  }
  registerAgent(
    projectId: string,
    resourceId: string,
    id: string,
    version: number,
    threadId: string,
  ) {
    const item = this.get(projectId, resourceId, id);
    this.db.transaction((tx) => {
      tx.insert(projectAgentThreads)
        .values({
          threadId,
          projectId,
          workspacePath: this.resource(projectId, resourceId).project
            .workspacePath,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .run();
      if (
        !tx
          .update(items)
          .set({
            conversations: [
              ...item.conversations,
              { type: 'agent', id: threadId },
            ],
            version: item.version + 1,
            updatedAt: Date.now(),
          })
          .where(and(eq(items.id, id), eq(items.version, version)))
          .run().changes
      )
        throw new ConflictException(
          'Deliverable changed during agent creation',
        );
    });
  }
  versionFiles(
    projectId: string,
    resourceId: string,
    id: string,
    versionId: string,
  ) {
    this.get(projectId, resourceId, id);
    return this.getVersion(id, versionId).files;
  }
  private resource(projectId: string, resourceId: string) {
    requireProjectAccess(projectId);
    const resource = this.db
      .select()
      .from(projectResources)
      .where(
        and(
          eq(projectResources.id, resourceId),
          eq(projectResources.projectId, projectId),
          eq(projectResources.type, 'deliverable_board'),
        ),
      )
      .get();
    if (!resource)
      throw new NotFoundException('Deliverables manager not found');
    const project = this.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .get()!;
    return { resource, project };
  }
  get(projectId: string, resourceId: string, id: string) {
    this.resource(projectId, resourceId);
    const item = this.db
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.resourceId, resourceId)))
      .get();
    if (!item) throw new NotFoundException('Deliverable not found');
    return item;
  }
  private options(projectId: string) {
    return {
      assignees: this.db
        .select({ id: people.id, name: people.name })
        .from(projectParticipants)
        .innerJoin(people, eq(projectParticipants.personId, people.id))
        .where(
          and(
            eq(projectParticipants.projectId, projectId),
            eq(people.active, true),
          ),
        )
        .all(),
      taskManagers: this.db
        .select({ id: projectResources.id, name: projectResources.name })
        .from(projectResources)
        .where(
          and(
            eq(projectResources.projectId, projectId),
            eq(projectResources.type, 'task_board'),
          ),
        )
        .all(),
      tasks: this.db
        .select({
          id: projectTasks.id,
          title: projectTasks.title,
          resourceId: projectTasks.resourceId,
          parentTaskId: projectTasks.parentTaskId,
          status: projectTaskStatuses.name,
          progress: projectTasks.progress,
          dueAt: projectTasks.dueAt,
          assigneeId: projectTasks.assigneeId,
          assigneeName: people.name,
        })
        .from(projectTasks)
        .innerJoin(
          projectResources,
          eq(projectTasks.resourceId, projectResources.id),
        )
        .innerJoin(
          projectTaskStatuses,
          eq(projectTasks.statusId, projectTaskStatuses.id),
        )
        .leftJoin(people, eq(projectTasks.assigneeId, people.id))
        .where(eq(projectResources.projectId, projectId))
        .all(),
      conversations: [
        ...this.db
          .select({ id: projectAgentThreads.threadId })
          .from(projectAgentThreads)
          .where(eq(projectAgentThreads.projectId, projectId))
          .all()
          .map((row) => ({ ...row, type: 'agent' as const, title: row.id })),
        ...this.db
          .select({ id: simpleChatThreads.id, title: simpleChatThreads.title })
          .from(simpleChatThreads)
          .where(eq(simpleChatThreads.projectId, projectId))
          .all()
          .map((row) => ({ ...row, type: 'simple' as const })),
      ],
    };
  }
  board(projectId: string, resourceId: string) {
    const context = this.resource(projectId, resourceId);
    const records = this.db
      .select()
      .from(items)
      .where(eq(items.resourceId, resourceId))
      .orderBy(desc(items.updatedAt))
      .all();
    const history = records.length
      ? this.db
          .select()
          .from(versions)
          .where(
            inArray(
              versions.deliverableId,
              records.map((row) => row.id),
            ),
          )
          .orderBy(desc(versions.number))
          .all()
      : [];
    const documentRows = records.length
      ? this.db
          .select()
          .from(documents)
          .where(
            inArray(
              documents.deliverableId,
              records.map((row) => row.id),
            ),
          )
          .all()
      : [];
    const documentHistory = documentRows.length
      ? this.db
          .select()
          .from(documentVersions)
          .where(
            inArray(
              documentVersions.documentId,
              documentRows.map((row) => row.id),
            ),
          )
          .orderBy(desc(documentVersions.number))
          .all()
      : [];
    const lifecycleHistory = records.length
      ? this.db
          .select()
          .from(lifecycleEvents)
          .where(
            inArray(
              lifecycleEvents.deliverableId,
              records.map((row) => row.id),
            ),
          )
          .orderBy(desc(lifecycleEvents.createdAt))
          .all()
      : [];
    const snapshotHistory = records.length
      ? this.db
          .select()
          .from(snapshots)
          .where(
            inArray(
              snapshots.deliverableId,
              records.map((row) => row.id),
            ),
          )
          .orderBy(desc(snapshots.createdAt))
          .all()
      : [];
    return {
      ...context,
      ...this.options(projectId),
      deliverables: records.map((item) => ({
        ...item,
        directory: path.join(
          context.project.workspacePath,
          'livrables',
          item.id,
        ),
        versions: history.filter(
          (version) =>
            version.deliverableId === item.id &&
            version.files.every((file) => this.canReadSource(file.sourcePath)),
        ),
        documents: documentRows
          .filter((document) => document.deliverableId === item.id)
          .map((document) => ({
            ...document,
            versions: documentHistory.filter(
              (version) => version.documentId === document.id,
            ),
          })),
        lifecycleEvents: lifecycleHistory.filter(
          (event) => event.deliverableId === item.id,
        ),
        snapshots: snapshotHistory.filter(
          (snapshot) => snapshot.deliverableId === item.id,
        ),
      })),
    };
  }
  private text(value: unknown, max: number, required = false) {
    if (
      typeof value !== 'string' ||
      value.length > max ||
      (required && !value.trim())
    )
      throw new BadRequestException('Invalid deliverable text');
    return required ? value.trim() : value;
  }
  private changes(projectId: string, input: DeliverableInput, current?: Item) {
    const options = this.options(projectId);
    const assigneeId =
      input.assigneeId === undefined
        ? (current?.assigneeId ?? null)
        : input.assigneeId || null;
    if (
      assigneeId &&
      !options.assignees.some((p) => p.id === assigneeId) &&
      assigneeId !== current?.assigneeId
    )
      throw new BadRequestException(
        'Responsible person must be an active project participant',
      );
    const dueAt =
      input.dueAt === undefined ? (current?.dueAt ?? null) : input.dueAt;
    if (
      dueAt !== null &&
      (!Number.isSafeInteger(dueAt) || dueAt < 0 || dueAt > 8640000000000000)
    )
      throw new BadRequestException('Invalid due date');
    const status = input.status ?? current?.status ?? 'planned';
    if (
      !['planned', 'in_progress', 'review'].includes(status) &&
      !(status === 'validated' && current?.status === 'validated')
    )
      throw new BadRequestException(
        'Validate a submitted version to validate a deliverable',
      );
    const taskIds = input.taskIds ?? current?.taskIds ?? [];
    const primaryTaskId =
      input.primaryTaskId === undefined
        ? (current?.primaryTaskId ?? null)
        : input.primaryTaskId || null;
    const conversations = input.conversations ?? current?.conversations ?? [];
    if (
      !Array.isArray(taskIds) ||
      taskIds.length > 100 ||
      taskIds.some(
        (id) =>
          typeof id !== 'string' ||
          (!options.tasks.some((t) => t.id === id) &&
            !current?.taskIds.includes(id)),
      )
    )
      throw new BadRequestException('Tasks must belong to this project');
    if (
      primaryTaskId &&
      !options.tasks.some(
        (task) => task.id === primaryTaskId && task.parentTaskId === null,
      )
    )
      throw new BadRequestException(
        'Primary task must be a main task in this project',
      );
    if (
      !Array.isArray(conversations) ||
      conversations.length > 100 ||
      conversations.some(
        (link) =>
          !link ||
          !['agent', 'simple'].includes(link.type) ||
          typeof link.id !== 'string' ||
          (!options.conversations.some(
            (c) => c.id === link.id && c.type === link.type,
          ) &&
            !current?.conversations.some(
              (c) => c.id === link.id && c.type === link.type,
            )),
      )
    )
      throw new BadRequestException(
        'Conversations must belong to this project',
      );
    return {
      title:
        input.title === undefined && current
          ? current.title
          : this.text(input.title, 160, true),
      description:
        input.description === undefined
          ? (current?.description ?? '')
          : this.text(input.description, 20000),
      criteria:
        input.criteria === undefined
          ? (current?.criteria ?? '')
          : this.text(input.criteria, 10000),
      assigneeId,
      dueAt,
      status,
      taskIds: [...new Set(taskIds)],
      primaryTaskId,
      conversations,
    };
  }
  private async directory(projectId: string, parts: string[], create = true) {
    const project = this.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .get();
    if (!project || project.workspaceLayoutVersion < 1)
      throw new ConflictException('Primary workspace is required');
    let directory = project.workspacePath;
    for (const part of ['', ...parts]) {
      if (part) {
        directory = path.join(directory, part);
        if (create)
          await fs
            .mkdir(directory, { recursive: false })
            .catch((error: NodeJS.ErrnoException) => {
              if (error.code !== 'EEXIST') throw error;
            });
      }
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new ConflictException(
          'Deliverable directories must not be symbolic links',
        );
    }
    return directory;
  }
  async create(projectId: string, resourceId: string, input: DeliverableInput) {
    this.resource(projectId, resourceId);
    const values = this.changes(projectId, input);
    const id = randomUUID(),
      now = Date.now();
    await this.directory(projectId, ['livrables', id]);
    const actor = this.actor();
    return this.db.transaction((tx) => {
      const created = tx
        .insert(items)
        .values({ id, resourceId, ...values, createdAt: now, updatedAt: now })
        .returning()
        .get();
      tx.insert(lifecycleEvents)
        .values({
          id: randomUUID(),
          deliverableId: id,
          fromStatus: null,
          toStatus: 'draft',
          actorPersonId: actor.personId,
          actorName: actor.name,
          createdAt: now,
        })
        .run();
      return created;
    });
  }
  update(
    projectId: string,
    resourceId: string,
    id: string,
    input: DeliverableInput,
  ) {
    const current = this.get(projectId, resourceId, id);
    if (current.lifecycleStatus === 'archived')
      throw new ConflictException('Archived deliverables are read-only');
    if (input.version !== current.version)
      throw new ConflictException('Deliverable changed. Reload before saving.');
    const changed = this.db
      .update(items)
      .set({
        ...this.changes(projectId, input, current),
        version: current.version + 1,
        updatedAt: Date.now(),
      })
      .where(and(eq(items.id, id), eq(items.version, current.version)))
      .returning()
      .get();
    if (!changed)
      throw new ConflictException('Deliverable changed. Reload before saving.');
    return changed;
  }

  transitionLifecycle(
    projectId: string,
    resourceId: string,
    id: string,
    input: { target?: unknown; version?: unknown },
  ) {
    const current = this.get(projectId, resourceId, id);
    const target = input.target as DeliverableLifecycleStatus;
    if (
      !Number.isSafeInteger(input.version) ||
      input.version !== current.version
    )
      throw new ConflictException('Deliverable changed. Reload before saving.');
    if (!LIFECYCLE_TRANSITIONS[current.lifecycleStatus].includes(target))
      throw new BadRequestException('Invalid deliverable lifecycle transition');

    const actor = this.actor();
    const now = Date.now();
    let snapshotId: string | null = null;
    let snapshotDocuments: DeliverableSnapshotDocument[] = [];
    if (target === 'finalized' && current.lifecycleStatus !== 'archived') {
      const activeDocuments = this.db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.deliverableId, id),
            sql`${documents.deletedAt} is null`,
          ),
        )
        .all();
      if (!activeDocuments.length)
        throw new ConflictException(
          'A deliverable needs at least one document before finalization',
        );
      snapshotDocuments = activeDocuments.map((document) => {
        const version = this.db
          .select()
          .from(documentVersions)
          .where(
            and(
              eq(documentVersions.documentId, document.id),
              eq(documentVersions.number, document.currentVersionNumber),
            ),
          )
          .get();
        if (!version)
          throw new ConflictException('A current document version is missing');
        return {
          documentId: document.id,
          documentVersionId: version.id,
          versionNumber: version.number,
          sha256: version.sha256,
        };
      });
      snapshotId = randomUUID();
    }

    return this.db.transaction((tx) => {
      if (snapshotId) {
        tx.insert(snapshots)
          .values({
            id: snapshotId,
            deliverableId: id,
            documents: snapshotDocuments,
            createdByPersonId: actor.personId,
            createdByName: actor.name,
            createdAt: now,
          })
          .run();
      }
      const changed = tx
        .update(items)
        .set({
          lifecycleStatus: target,
          ...(snapshotId
            ? {
                currentSnapshotId: snapshotId,
                finalizedAt: now,
                finalizedByPersonId: actor.personId,
                finalizedByName: actor.name,
              }
            : {}),
          version: current.version + 1,
          updatedAt: now,
        })
        .where(and(eq(items.id, id), eq(items.version, current.version)))
        .run();
      if (!changed.changes)
        throw new ConflictException('Deliverable changed during transition');
      tx.insert(lifecycleEvents)
        .values({
          id: randomUUID(),
          deliverableId: id,
          fromStatus: current.lifecycleStatus,
          toStatus: target,
          snapshotId,
          actorPersonId: actor.personId,
          actorName: actor.name,
          createdAt: now,
        })
        .run();
      return tx.select().from(items).where(eq(items.id, id)).get()!;
    });
  }

  private actor(): DeliverableDocumentActor {
    const identity = currentAccess()?.identity;
    return {
      personId: identity?.personId ?? null,
      name: identity?.name ?? 'System',
    };
  }

  private requireDocumentMutable(item: Item) {
    if (
      item.lifecycleStatus !== 'draft' &&
      item.lifecycleStatus !== 'in_constitution'
    )
      throw new ConflictException(
        'Reopen the deliverable before changing its documents',
      );
  }
  remove(projectId: string, resourceId: string, id: string, version: number) {
    this.get(projectId, resourceId, id);
    if (
      !this.db
        .delete(items)
        .where(and(eq(items.id, id), eq(items.version, version)))
        .run().changes
    )
      throw new ConflictException(
        'Deliverable changed. Reload before removing.',
      );
    return { ok: true, filesPreserved: true };
  }
  private async hash(file: string) {
    const digest = createHash('sha256');
    let size = 0;
    for await (const chunk of createReadStream(file)) {
      const buffer = chunk as Buffer;
      size += buffer.length;
      if (size > MAX_FILE)
        throw new BadRequestException('File exceeds 100 MiB');
      digest.update(buffer);
    }
    return { sha256: digest.digest('hex'), size };
  }
  async submit(
    projectId: string,
    resourceId: string,
    id: string,
    input: { paths: string[]; note?: string; version: number },
  ) {
    const current = this.get(projectId, resourceId, id);
    this.requireDocumentMutable(current);
    if (current.version !== input.version)
      throw new ConflictException(
        'Deliverable changed. Reload before submitting.',
      );
    if (
      !Array.isArray(input.paths) ||
      !input.paths.length ||
      input.paths.length > 10 ||
      input.paths.some((value) => typeof value !== 'string')
    )
      throw new BadRequestException('Provide between one and ten file paths');
    const note = this.text(input.note ?? '', 4000);
    const roots = await Promise.all(
      this.db
        .select()
        .from(projectWorkspaces)
        .where(eq(projectWorkspaces.projectId, projectId))
        .all()
        .map((w) => fs.realpath(w.path).catch(() => null)),
    );
    const versionId = randomUUID();
    const folder = await this.directory(projectId, [
      '.webui',
      'history',
      'deliverables',
      id,
      versionId,
    ]);
    const files: DeliverableFile[] = [];
    try {
      let total = 0;
      for (const [index, source] of input.paths.entries()) {
        const sourcePath = await this.files.resolveSafePath(source);
        // Snapshots are shared project outputs, so never copy server credentials
        // into a project even when an administrator attached a broad workspace.
        this.identities.requireWorkspacePath(sourcePath);
        if (
          !roots.some((root) => root && sourcePath.startsWith(root + path.sep))
        )
          throw new BadRequestException(
            'Files must belong to a project workspace',
          );
        this.files.assertProjectPathMutable(sourcePath);
        const stat = await fs.stat(sourcePath);
        if (
          !stat.isFile() ||
          stat.size > MAX_FILE ||
          (total += stat.size) > 200 * 1024 * 1024
        )
          throw new BadRequestException(
            'Invalid file or version exceeds 200 MiB',
          );
        const name = path.basename(sourcePath),
          snapshotPath = path.join(folder, `${index}-${name}`);
        await fs.copyFile(sourcePath, snapshotPath, constants.COPYFILE_EXCL);
        const after = await fs.stat(sourcePath);
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
          throw new ConflictException('Source file changed during submission');
        files.push({
          name,
          sourcePath,
          snapshotPath,
          ...(await this.hash(snapshotPath)),
        });
      }
      return this.db.transaction((tx) => {
        const existing = tx
          .select()
          .from(versions)
          .where(eq(versions.deliverableId, id))
          .all();
        const created = tx
          .insert(versions)
          .values({
            id: versionId,
            deliverableId: id,
            number: Math.max(0, ...existing.map((v) => v.number)) + 1,
            note,
            files,
            createdAt: Date.now(),
          })
          .returning()
          .get();
        const access = currentAccess();
        for (const file of files) {
          let document = tx
            .select()
            .from(documents)
            .where(
              and(
                eq(documents.deliverableId, id),
                eq(documents.sourcePath, file.sourcePath),
              ),
            )
            .get();
          if (!document) {
            const documentId = randomUUID();
            document = tx
              .insert(documents)
              .values({
                id: documentId,
                deliverableId: id,
                name: file.name,
                format: path.extname(file.name).slice(1).toLowerCase(),
                sourcePath: file.sourcePath,
                currentVersionNumber: 0,
                createdAt: created.createdAt,
                updatedAt: created.createdAt,
              })
              .returning()
              .get();
          }
          const latest = tx
            .select()
            .from(documentVersions)
            .where(eq(documentVersions.documentId, document.id))
            .orderBy(desc(documentVersions.number))
            .get();
          if (latest?.sha256 === file.sha256) continue;
          const number = (latest?.number ?? 0) + 1;
          tx.insert(documentVersions)
            .values({
              id: randomUUID(),
              documentId: document.id,
              number,
              fileName: file.name,
              sourcePath: file.sourcePath,
              snapshotPath: file.snapshotPath,
              size: file.size,
              sha256: file.sha256,
              authorPersonId: access?.identity.personId ?? null,
              authorName: access?.identity.name ?? 'Utilisateur',
              comment: note,
              createdAt: created.createdAt,
            })
            .run();
          tx.update(documents)
            .set({
              name: file.name,
              format: path.extname(file.name).slice(1).toLowerCase(),
              currentVersionNumber: number,
              deletedAt: null,
              updatedAt: created.createdAt,
            })
            .where(eq(documents.id, document.id))
            .run();
        }
        if (
          !tx
            .update(items)
            .set({
              status: 'review',
              ...(current.lifecycleStatus === 'draft'
                ? { lifecycleStatus: 'in_constitution' as const }
                : {}),
              version: current.version + 1,
              updatedAt: Date.now(),
            })
            .where(and(eq(items.id, id), eq(items.version, current.version)))
            .run().changes
        )
          throw new ConflictException('Deliverable changed during submission');
        if (current.lifecycleStatus === 'draft')
          tx.insert(lifecycleEvents)
            .values({
              id: randomUUID(),
              deliverableId: id,
              fromStatus: 'draft',
              toStatus: 'in_constitution',
              actorPersonId: access?.identity.personId ?? null,
              actorName: access?.identity.name ?? 'Utilisateur',
              createdAt: Date.now(),
            })
            .run();
        return created;
      });
    } catch (error) {
      await fs.rm(folder, { recursive: true, force: true });
      throw error;
    }
  }

  documents(projectId: string, resourceId: string, deliverableId: string) {
    this.get(projectId, resourceId, deliverableId);
    const rows = this.db
      .select()
      .from(documents)
      .where(eq(documents.deliverableId, deliverableId))
      .orderBy(desc(documents.updatedAt))
      .all();
    const history = rows.length
      ? this.db
          .select()
          .from(documentVersions)
          .where(
            inArray(
              documentVersions.documentId,
              rows.map((row) => row.id),
            ),
          )
          .orderBy(desc(documentVersions.number))
          .all()
      : [];
    return rows.map((document) => ({
      ...document,
      versions: history.filter((version) => version.documentId === document.id),
    }));
  }

  async addDocumentVersion(
    projectId: string,
    resourceId: string,
    deliverableId: string,
    input: {
      path?: unknown;
      comment?: unknown;
      expectedVersion?: unknown;
    },
    actor: DeliverableDocumentActor,
    documentId?: string,
  ) {
    const deliverable = this.get(projectId, resourceId, deliverableId);
    this.requireDocumentMutable(deliverable);
    if (typeof input.path !== 'string' || !input.path.trim())
      throw new BadRequestException('Document path is required');
    const comment = this.text(input.comment ?? '', 4000);
    const sourcePath = await this.files.resolveSafePath(input.path);
    this.identities.requireWorkspacePath(sourcePath);
    const workspaces = this.db
      .select()
      .from(projectWorkspaces)
      .where(eq(projectWorkspaces.projectId, projectId))
      .all();
    const roots = await Promise.all(
      workspaces.map((workspace) =>
        fs.realpath(workspace.path).catch(() => null),
      ),
    );
    if (!roots.some((root) => root && sourcePath.startsWith(root + path.sep)))
      throw new BadRequestException(
        'Document must belong to a project workspace',
      );
    this.files.assertProjectPathMutable(sourcePath);
    const stat = await fs.stat(sourcePath);
    if (!stat.isFile() || stat.size > MAX_FILE)
      throw new BadRequestException('Invalid document file');
    const fileName = path.basename(sourcePath);
    let document = documentId
      ? this.db
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.id, documentId),
              eq(documents.deliverableId, deliverableId),
            ),
          )
          .get()
      : undefined;
    if (documentId && !document)
      throw new NotFoundException('Document not found');
    if (!document) {
      const duplicate = this.db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.deliverableId, deliverableId),
            eq(documents.sourcePath, sourcePath),
          ),
        )
        .get();
      if (duplicate)
        throw new ConflictException(
          'This document already belongs to the deliverable',
        );
    } else if (sourcePath !== document.sourcePath) {
      throw new BadRequestException(
        'A document version must use the document source path',
      );
    } else if (
      input.expectedVersion !== document.currentVersionNumber ||
      document.deletedAt !== null
    ) {
      throw new ConflictException('Document changed. Reload before saving.');
    }
    const digest = await this.hash(sourcePath);
    const latest = document
      ? this.db
          .select()
          .from(documentVersions)
          .where(eq(documentVersions.documentId, document.id))
          .orderBy(desc(documentVersions.number))
          .get()
      : undefined;
    if (latest?.sha256 === digest.sha256)
      throw new ConflictException('Document content has not changed');
    const id = document?.id ?? randomUUID();
    const versionId = randomUUID();
    const number = (latest?.number ?? 0) + 1;
    const folder = await this.directory(projectId, [
      '.webui',
      'history',
      'deliverables',
      deliverableId,
      'documents',
      id,
      versionId,
    ]);
    const snapshotPath = path.join(folder, fileName);
    await fs.copyFile(sourcePath, snapshotPath, constants.COPYFILE_EXCL);
    const after = await fs.stat(sourcePath);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) {
      await fs.rm(folder, { recursive: true, force: true });
      throw new ConflictException(
        'Document changed while its version was created',
      );
    }
    const now = Date.now();
    try {
      return this.db.transaction((tx) => {
        if (!document) {
          document = tx
            .insert(documents)
            .values({
              id,
              deliverableId,
              name: fileName,
              format: path.extname(fileName).slice(1).toLowerCase(),
              sourcePath,
              currentVersionNumber: number,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get();
        } else {
          const changed = tx
            .update(documents)
            .set({
              name: fileName,
              format: path.extname(fileName).slice(1).toLowerCase(),
              sourcePath,
              currentVersionNumber: number,
              updatedAt: now,
            })
            .where(
              and(
                eq(documents.id, id),
                eq(documents.currentVersionNumber, latest?.number ?? 0),
              ),
            )
            .run();
          if (!changed.changes)
            throw new ConflictException('Document changed while saving');
        }
        const version = tx
          .insert(documentVersions)
          .values({
            id: versionId,
            documentId: id,
            number,
            fileName,
            sourcePath,
            snapshotPath,
            ...digest,
            authorPersonId: actor.personId,
            authorName: actor.name,
            comment,
            createdAt: now,
          })
          .returning()
          .get();
        if (deliverable.lifecycleStatus === 'draft') {
          tx.update(items)
            .set({
              lifecycleStatus: 'in_constitution',
              version: deliverable.version + 1,
              updatedAt: now,
            })
            .where(
              and(
                eq(items.id, deliverableId),
                eq(items.version, deliverable.version),
              ),
            )
            .run();
          tx.insert(lifecycleEvents)
            .values({
              id: randomUUID(),
              deliverableId,
              fromStatus: 'draft',
              toStatus: 'in_constitution',
              actorPersonId: actor.personId,
              actorName: actor.name,
              createdAt: now,
            })
            .run();
        }
        return { document, version };
      });
    } catch (error) {
      await fs.rm(folder, { recursive: true, force: true });
      throw error;
    }
  }

  setDocumentDeleted(
    projectId: string,
    resourceId: string,
    deliverableId: string,
    documentId: string,
    expectedVersion: unknown,
    deleted: boolean,
  ) {
    const deliverable = this.get(projectId, resourceId, deliverableId);
    this.requireDocumentMutable(deliverable);
    if (!Number.isSafeInteger(expectedVersion))
      throw new BadRequestException('Invalid document version');
    const document = this.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.deliverableId, deliverableId),
        ),
      )
      .get();
    if (!document) throw new NotFoundException('Document not found');
    if (document.currentVersionNumber !== expectedVersion)
      throw new ConflictException('Document changed. Reload before saving.');
    this.db
      .update(documents)
      .set({ deletedAt: deleted ? Date.now() : null, updatedAt: Date.now() })
      .where(eq(documents.id, documentId))
      .run();
    return { ok: true };
  }

  private getDocument(deliverableId: string, documentId: string) {
    const document = this.db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.id, documentId),
          eq(documents.deliverableId, deliverableId),
        ),
      )
      .get();
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }

  private getDocumentVersion(documentId: string, versionId: string) {
    const version = this.db
      .select()
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.id, versionId),
          eq(documentVersions.documentId, documentId),
        ),
      )
      .get();
    if (!version) throw new NotFoundException('Document version not found');
    return version;
  }

  async documentVersionFile(
    projectId: string,
    resourceId: string,
    deliverableId: string,
    documentId: string,
    versionId: string,
  ) {
    this.get(projectId, resourceId, deliverableId);
    const document = this.getDocument(deliverableId, documentId);
    const version = this.getDocumentVersion(documentId, versionId);
    const folder = await this.directory(
      projectId,
      [
        '.webui',
        'history',
        'deliverables',
        deliverableId,
        'documents',
        documentId,
        versionId,
      ],
      false,
    );
    const resolved = await fs.realpath(version.snapshotPath);
    if (
      path.dirname(resolved) !== (await fs.realpath(folder)) ||
      (await fs.lstat(version.snapshotPath)).isSymbolicLink()
    )
      throw new ConflictException('Invalid document version file');
    const actual = await this.hash(resolved);
    if (actual.sha256 !== version.sha256 || actual.size !== version.size)
      throw new ConflictException('Document version file was modified');
    return { document, version, path: resolved };
  }

  async restoreDocumentVersion(
    projectId: string,
    resourceId: string,
    deliverableId: string,
    documentId: string,
    versionId: string,
    input: { expectedVersion?: unknown; comment?: unknown },
    actor: DeliverableDocumentActor,
  ) {
    const deliverable = this.get(projectId, resourceId, deliverableId);
    this.requireDocumentMutable(deliverable);
    const document = this.getDocument(deliverableId, documentId);
    if (
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion !== document.currentVersionNumber ||
      document.deletedAt !== null
    )
      throw new ConflictException('Document changed. Reload before restoring.');
    const historical = await this.documentVersionFile(
      projectId,
      resourceId,
      deliverableId,
      documentId,
      versionId,
    );
    await fs.copyFile(historical.path, document.sourcePath);
    const result = await this.addDocumentVersion(
      projectId,
      resourceId,
      deliverableId,
      {
        path: document.sourcePath,
        expectedVersion: document.currentVersionNumber,
        comment:
          input.comment ??
          `Restauration de la version ${historical.version.number}`,
      },
      actor,
      documentId,
    );
    this.db
      .update(documentVersions)
      .set({ restoredFromVersionId: versionId })
      .where(eq(documentVersions.id, result.version.id))
      .run();
    return result;
  }
  private getVersion(id: string, versionId: string) {
    const version = this.db
      .select()
      .from(versions)
      .where(and(eq(versions.id, versionId), eq(versions.deliverableId, id)))
      .get();
    if (!version) throw new NotFoundException('Deliverable version not found');
    return version;
  }
  async file(
    projectId: string,
    resourceId: string,
    id: string,
    versionId: string,
    index: number,
  ) {
    this.get(projectId, resourceId, id);
    const file = this.getVersion(id, versionId).files[index];
    if (!Number.isSafeInteger(index) || index < 0 || !file)
      throw new NotFoundException('File not found');
    const access = currentAccess();
    if (access && access.identity.role !== 'administrator')
      this.identities.requireWorkspacePath(
        file.sourcePath,
        false,
        access.identity,
      );
    const folder = await this.directory(
      projectId,
      ['.webui', 'history', 'deliverables', id, versionId],
      false,
    );
    const resolved = await fs.realpath(file.snapshotPath);
    if (
      path.dirname(resolved) !== (await fs.realpath(folder)) ||
      (await fs.lstat(file.snapshotPath)).isSymbolicLink()
    )
      throw new ConflictException('Invalid version file');
    const actual = await this.hash(resolved);
    if (actual.sha256 !== file.sha256 || actual.size !== file.size)
      throw new ConflictException(
        'Version file was modified outside the manager',
      );
    return file;
  }

  private canReadSource(path: string): boolean {
    const access = currentAccess();
    if (!access || access.identity.role === 'administrator') return true;
    try {
      this.identities.requireWorkspacePath(path, false, access.identity);
      return true;
    } catch {
      return false;
    }
  }
  async review(
    projectId: string,
    resourceId: string,
    id: string,
    versionId: string,
    input: { action: 'validate' | 'reject'; version: number },
    reviewer: string,
  ) {
    const current = this.get(projectId, resourceId, id),
      version = this.getVersion(id, versionId);
    if (
      input.version !== current.version ||
      !['validate', 'reject'].includes(input.action)
    )
      throw new ConflictException('Invalid or outdated version review');
    if (input.action === 'validate')
      for (let index = 0; index < version.files.length; index++)
        await this.file(projectId, resourceId, id, versionId, index);
    return this.db.transaction((tx) => {
      if (
        !tx
          .update(items)
          .set({
            status: input.action === 'validate' ? 'validated' : 'in_progress',
            ...(input.action === 'validate'
              ? { validatedVersionId: versionId }
              : {}),
            version: current.version + 1,
            updatedAt: Date.now(),
          })
          .where(and(eq(items.id, id), eq(items.version, current.version)))
          .run().changes
      )
        throw new ConflictException('Deliverable changed during review');
      if (version.status === 'validated' && input.action === 'reject')
        throw new ConflictException('A validated version cannot be rejected');
      tx.update(versions)
        .set({
          status: input.action === 'validate' ? 'validated' : 'rejected',
          reviewer,
          reviewedAt: Date.now(),
        })
        .where(eq(versions.id, versionId))
        .run();
      return this.get(projectId, resourceId, id);
    });
  }
}
