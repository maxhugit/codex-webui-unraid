import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import { DRIZZLE_DB, type AppDatabase } from '../database/database.constants';
import {
  projects,
  projectResources,
  projectTasks,
  projectTaskDependencies,
  projectTaskStatuses,
  projectAgentThreads,
  projectWorkspaces,
  simpleChatThreads,
  type Project,
  type ProjectWorkspace,
  type ProjectResource,
  type ProjectTask,
  type ProjectTaskStatus,
} from '../database/schema';
import { FilesService } from '../files/files.service';
import { WorkspacesManagementService } from '../threads/workspaces-management.service';
import { ThreadMetadataService } from '../threads/thread-metadata.service';
import { ThreadWorkspaceOverridesService } from '../threads/thread-workspace-overrides.service';
import { ThreadsDeletionService } from '../threads/threads-deletion.service';
import { ThreadsService } from '../threads/threads.service';
import { SimpleChatService } from '../simple-chat/simple-chat.service';

const ORPHAN_ASSOCIATION_GRACE_MS = 5 * 60_000;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly files: FilesService,
    private readonly workspaces: WorkspacesManagementService,
    private readonly metadata: ThreadMetadataService,
    private readonly overrides: ThreadWorkspaceOverridesService,
    private readonly deletion: ThreadsDeletionService,
    private readonly threads: ThreadsService,
    private readonly simpleChat: SimpleChatService,
    @Inject(DRIZZLE_DB) private readonly db: AppDatabase,
  ) {}

  async list(): Promise<
    Array<
      Project & {
        workspaces: ProjectWorkspace[];
        resources: ProjectResource[];
        agentThreads: Array<{
          threadId: string;
          workspacePath: string;
          title: string;
          archived: boolean;
          taskId: string | null;
          taskResourceId: string | null;
          taskTitle: string | null;
          isSubtask: boolean;
        }>;
      }
    >
  > {
    this.ensurePrimaryWorkspaces();
    await this.migrateConversationAssociations();
    const workspaces = this.db.select().from(projectWorkspaces).all();
    const resources = this.db.select().from(projectResources).all();
    const tasks = this.db.select().from(projectTasks).all();
    let agents = this.db.select().from(projectAgentThreads).all();
    const snapshot = await this.metadata.read().catch(() => null);
    const snapshotEntries = snapshot?.entries ?? [];
    const effectiveThreads = this.overrides.applyToThreads(
      snapshotEntries.map((entry) => entry.thread),
    );
    const threadMetadata = new Map(
      snapshotEntries.map((entry, index) => [
        entry.thread.id,
        { thread: effectiveThreads[index], archived: entry.archived },
      ]),
    );
    // A thread cwd can also be changed through the generic thread endpoint or
    // by Codex itself. Keep the explicit project association aligned with the
    // effective cwd whenever it resolves to another workspace in that project.
    const workspaceOwners = new Map(
      workspaces.map((workspace) => [workspace.path, workspace]),
    );
    const now = Date.now();
    for (const agent of agents) {
      const cwd = threadMetadata.get(agent.threadId)?.thread.cwd;
      const owner = cwd ? workspaceOwners.get(cwd) : undefined;
      if (
        !owner ||
        owner.projectId !== agent.projectId ||
        owner.path === agent.workspacePath
      )
        continue;
      this.db
        .update(projectAgentThreads)
        .set({ workspacePath: owner.path, updatedAt: now })
        .where(eq(projectAgentThreads.threadId, agent.threadId))
        .run();
    }
    agents = this.db.select().from(projectAgentThreads).all();
    // Codex does not expose empty placeholders as conversations. Keep a short
    // grace period for a freshly-created agent, then discard only its WebUI
    // association when it never became visible or was deleted elsewhere.
    if (snapshot) {
      const orphanCutoff = Date.now() - ORPHAN_ASSOCIATION_GRACE_MS;
      for (const agent of agents)
        if (
          !threadMetadata.has(agent.threadId) &&
          agent.updatedAt < orphanCutoff
        )
          this.db
            .delete(projectAgentThreads)
            .where(eq(projectAgentThreads.threadId, agent.threadId))
            .run();
    }
    return this.db
      .select()
      .from(projects)
      .all()
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      )
      .map((project) => ({
        ...project,
        workspaces: workspaces
          .filter((workspace) => workspace.projectId === project.id)
          .sort((a, b) => Number(b.primary) - Number(a.primary)),
        resources: resources.filter(
          (resource) => resource.projectId === project.id,
        ),
        agentThreads: agents
          .filter(
            (agent) =>
              agent.projectId === project.id &&
              threadMetadata.has(agent.threadId),
          )
          .map(({ threadId, workspacePath }) => {
            const metadata = threadMetadata.get(threadId)!;
            const task = tasks.find(
              (candidate) => candidate.linkedThreadId === threadId,
            );
            return {
              threadId,
              workspacePath,
              title:
                metadata.thread.name?.trim() || metadata.thread.preview.trim(),
              archived: metadata.archived,
              taskId: task?.id ?? null,
              taskResourceId: task?.resourceId ?? null,
              taskTitle: task?.title ?? null,
              isSubtask: Boolean(task?.parentTaskId),
            };
          }),
      }));
  }

  /** Associates historical conversations once; future grouping never relies on cwd. */
  private async migrateConversationAssociations(): Promise<void> {
    const workspaces = this.db.select().from(projectWorkspaces).all();
    const ownerFor = (cwd: string) =>
      workspaces
        .filter(
          (workspace) =>
            cwd === workspace.path ||
            cwd.startsWith(`${workspace.path}${path.sep}`),
        )
        .sort((a, b) => b.path.length - a.path.length)[0];
    const now = Date.now();
    for (const chat of this.db.select().from(simpleChatThreads).all()) {
      if (chat.projectId) continue;
      const owner = ownerFor(chat.cwd);
      if (owner)
        this.db
          .update(simpleChatThreads)
          .set({ projectId: owner.projectId, updatedAt: now })
          .where(eq(simpleChatThreads.id, chat.id))
          .run();
    }
    const known = new Set(
      this.db
        .select({ threadId: projectAgentThreads.threadId })
        .from(projectAgentThreads)
        .all()
        .map((row) => row.threadId),
    );
    const snapshot = await this.metadata.read().catch(() => null);
    if (!snapshot) return;
    for (const thread of this.overrides.applyToThreads(
      snapshot.entries.map((entry) => entry.thread),
    )) {
      if (known.has(thread.id) || !thread.cwd) continue;
      const owner = ownerFor(thread.cwd);
      if (!owner) continue;
      this.db
        .insert(projectAgentThreads)
        .values({
          threadId: thread.id,
          projectId: owner.projectId,
          workspacePath: thread.cwd,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
    }
  }

  async associateAgent(
    projectId: string,
    threadId: string,
    workspacePath: string,
    alreadyAtWorkspace = false,
  ) {
    const workspace = this.requireWorkspace(projectId, workspacePath);
    const threadIds = alreadyAtWorkspace
      ? this.threads.rememberInitialThreadCwd(threadId, workspace.path)
      : await this.threads.setThreadCwd(threadId, workspace.path);
    const now = Date.now();
    this.db.transaction((tx) => {
      for (const id of threadIds)
        tx.insert(projectAgentThreads)
          .values({
            threadId: id,
            projectId,
            workspacePath: workspace.path,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: projectAgentThreads.threadId,
            set: { projectId, workspacePath: workspace.path, updatedAt: now },
          })
          .run();
    });
    return { threadIds, projectId, workspacePath: workspace.path };
  }

  setDefaultWorkspace(projectId: string, workspaceId: string) {
    const project = this.get(projectId);
    const selected = this.db
      .select()
      .from(projectWorkspaces)
      .where(
        and(
          eq(projectWorkspaces.id, workspaceId),
          eq(projectWorkspaces.projectId, projectId),
        ),
      )
      .get();
    if (!selected) throw new NotFoundException('Workspace not found');
    const now = Date.now();
    this.db.transaction((tx) => {
      for (const workspace of tx
        .select()
        .from(projectWorkspaces)
        .where(eq(projectWorkspaces.projectId, projectId))
        .all())
        tx.update(projectWorkspaces)
          .set({ primary: workspace.id === workspaceId, updatedAt: now })
          .where(eq(projectWorkspaces.id, workspace.id))
          .run();
      tx.update(projects)
        .set({ workspacePath: selected.path, updatedAt: now })
        .where(eq(projects.id, project.id))
        .run();
    });
    return selected;
  }

  async detachWorkspace(projectId: string, workspaceId: string) {
    const project = this.get(projectId);
    const workspace = this.db
      .select()
      .from(projectWorkspaces)
      .where(
        and(
          eq(projectWorkspaces.id, workspaceId),
          eq(projectWorkspaces.projectId, projectId),
        ),
      )
      .get();
    if (!workspace) throw new NotFoundException('Workspace not found');
    if (workspace.primary)
      throw new ConflictException('Choose another default workspace first');
    const agents = this.db
      .select()
      .from(projectAgentThreads)
      .where(
        and(
          eq(projectAgentThreads.projectId, projectId),
          eq(projectAgentThreads.workspacePath, workspace.path),
        ),
      )
      .all();
    const movedAgentIds = new Set<string>();
    for (const agent of agents)
      for (const threadId of await this.threads.setThreadCwd(
        agent.threadId,
        project.workspacePath,
      ))
        movedAgentIds.add(threadId);
    const now = Date.now();
    this.db.transaction((tx) => {
      for (const threadId of movedAgentIds)
        tx.insert(projectAgentThreads)
          .values({
            threadId,
            projectId,
            workspacePath: project.workspacePath,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: projectAgentThreads.threadId,
            set: {
              projectId,
              workspacePath: project.workspacePath,
              updatedAt: now,
            },
          })
          .run();
      tx.delete(projectWorkspaces)
        .where(eq(projectWorkspaces.id, workspaceId))
        .run();
    });
    return { ok: true, preservedPath: workspace.path };
  }

  /** Removes stale workspace rows and safely moves their conversations. */
  async reconcileMissingWorkspaces(): Promise<{
    removed: string[];
    reassignedAgents: number;
    reassignedSimpleChats: number;
    unresolved: string[];
  }> {
    const removed: string[] = [];
    const unresolved: string[] = [];
    let reassignedAgents = 0;
    const reassignedSimpleChats = 0;
    for (const project of this.db.select().from(projects).all()) {
      const attached = this.db
        .select()
        .from(projectWorkspaces)
        .where(eq(projectWorkspaces.projectId, project.id))
        .all();
      const existing: ProjectWorkspace[] = [];
      const missing: ProjectWorkspace[] = [];
      for (const workspace of attached) {
        ((await this.files.directoryExists(workspace.path))
          ? existing
          : missing
        ).push(workspace);
      }
      if (!missing.length) continue;
      // Never erase the last reference automatically: without a surviving
      // destination, conversations cannot be recovered safely.
      if (!existing.length) {
        unresolved.push(...missing.map((workspace) => workspace.path));
        continue;
      }
      const fallback =
        existing.find((workspace) => workspace.primary) ?? existing[0];
      const primaryWasMissing = missing.some((workspace) => workspace.primary);
      if (primaryWasMissing || project.workspacePath !== fallback.path) {
        const now = Date.now();
        this.db.transaction((tx) => {
          for (const workspace of attached)
            tx.update(projectWorkspaces)
              .set({ primary: workspace.id === fallback.id, updatedAt: now })
              .where(eq(projectWorkspaces.id, workspace.id))
              .run();
          tx.update(projects)
            .set({ workspacePath: fallback.path, updatedAt: now })
            .where(eq(projects.id, project.id))
            .run();
        });
      }
      for (const workspace of missing) {
        const reassigned = await this.workspaces.reassignMissingWorkspace(
          workspace.path,
          fallback.path,
        );
        reassignedAgents += reassigned.agents;
        this.db
          .update(projectAgentThreads)
          .set({ workspacePath: fallback.path, updatedAt: Date.now() })
          .where(
            and(
              eq(projectAgentThreads.projectId, project.id),
              eq(projectAgentThreads.workspacePath, workspace.path),
            ),
          )
          .run();
        this.db
          .delete(projectWorkspaces)
          .where(eq(projectWorkspaces.id, workspace.id))
          .run();
        removed.push(workspace.path);
      }
    }
    return {
      removed,
      reassignedAgents,
      reassignedSimpleChats,
      unresolved,
    };
  }

  async create(
    nameValue: string,
    workspacePathValue?: string,
  ): Promise<Project> {
    const name = this.validateName(nameValue);
    const requestedPath =
      workspacePathValue?.trim() || path.join('/workspaces', name);
    if (!path.isAbsolute(requestedPath))
      throw new BadRequestException('Workspace path must be absolute');

    const existed = await this.files.directoryExists(requestedPath);
    const workspacePath = existed
      ? await this.files.resolveSafePath(requestedPath)
      : await this.files.resolveSafeTargetPath(requestedPath, {
          recursiveParent: true,
        });
    const existingProject = this.db
      .select()
      .from(projects)
      .where(eq(projects.workspacePath, workspacePath))
      .get();
    const existingWorkspace = this.db
      .select()
      .from(projectWorkspaces)
      .where(eq(projectWorkspaces.path, workspacePath))
      .get();
    if (existingProject || existingWorkspace) {
      throw new ConflictException('A project already uses this workspace');
    }
    if (!existed) await this.files.createDirectory(workspacePath, true, false);
    const now = Date.now();
    const project: Project = {
      id: randomUUID(),
      name,
      workspacePath,
      createdAt: now,
      updatedAt: now,
    };
    try {
      this.db.transaction((tx) => {
        tx.insert(projects).values(project).run();
        tx.insert(projectWorkspaces)
          .values({
            id: randomUUID(),
            projectId: project.id,
            name: 'Principal',
            path: workspacePath,
            primary: true,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      });
      return project;
    } catch (error) {
      if (!existed) await this.cleanupNewProjectDirectory(workspacePath);
      throw error;
    }
  }

  private async cleanupNewProjectDirectory(
    workspacePath: string,
  ): Promise<void> {
    // The managed cleanup intentionally only accepts a direct child of
    // /workspaces. For a custom path we leave an empty directory behind on the
    // extremely rare database failure rather than risk deleting user data.
    await this.files.deleteManagedWorkspace(workspacePath).catch(() => {});
  }

  async createWorkspace(
    projectId: string,
    input: { name?: string; path?: string },
  ): Promise<ProjectWorkspace> {
    this.get(projectId);
    const requestedPath = input.path?.trim();
    const name = this.validateName(
      input.name ?? (requestedPath ? path.basename(requestedPath) : ''),
    );
    // A workspace is an independent execution context. It is deliberately not
    // nested below the project's primary workspace: projects group contexts,
    // they do not own a filesystem subtree.
    const workspacePath = requestedPath
      ? await this.files.resolveSafePath(requestedPath)
      : path.join('/workspaces', name);
    const existing = this.db
      .select()
      .from(projectWorkspaces)
      .where(eq(projectWorkspaces.path, workspacePath))
      .get();
    if (existing)
      throw new ConflictException(
        'This directory is already attached to a project',
      );

    let createdDirectory = false;
    if (requestedPath) {
      // Also validates that the selected safe path is a directory.
      await this.files.readDirectory(workspacePath);
    } else {
      await this.files.createDirectory(workspacePath, false, false);
      createdDirectory = true;
    }
    const now = Date.now();
    const workspace: ProjectWorkspace = {
      id: randomUUID(),
      projectId,
      name,
      path: workspacePath,
      primary: false,
      createdAt: now,
      updatedAt: now,
    };
    try {
      this.db.insert(projectWorkspaces).values(workspace).run();
      return workspace;
    } catch (error) {
      if (createdDirectory)
        await this.files.deleteManagedWorkspace(workspacePath).catch(() => {});
      throw error;
    }
  }

  createResource(
    projectId: string,
    input: { type: string; name?: string },
  ): ProjectResource {
    this.get(projectId);
    if (input.type !== 'task_board')
      throw new BadRequestException('Unsupported project resource type');
    const siblings = this.db
      .select()
      .from(projectResources)
      .where(
        and(
          eq(projectResources.projectId, projectId),
          eq(projectResources.type, input.type),
        ),
      )
      .all();
    const defaultName =
      siblings.length === 0
        ? 'Gestionnaire de tâches'
        : `Gestionnaire de tâches ${siblings.length + 1}`;
    const name = input.name?.trim() || defaultName;
    if (name.length > 120)
      throw new BadRequestException('Resource name is too long');
    const now = Date.now();
    const resource: ProjectResource = {
      id: randomUUID(),
      projectId,
      type: input.type,
      name,
      config: {},
      createdAt: now,
      updatedAt: now,
    };
    const defaultStatuses = [
      {
        name: 'Actions non assignées',
        color: 'slate',
        kind: 'unassigned',
        system: true,
      },
      { name: 'À faire', color: 'blue', kind: 'todo', system: false },
      { name: 'En cours', color: 'amber', kind: 'in_progress', system: false },
      { name: 'Bloqué', color: 'red', kind: 'blocked', system: false },
      { name: 'À valider', color: 'purple', kind: 'review', system: true },
      { name: 'Terminé', color: 'green', kind: 'done', system: false },
    ];
    this.db.transaction((tx) => {
      tx.insert(projectResources).values(resource).run();
      tx.insert(projectTaskStatuses)
        .values(
          defaultStatuses.map((status, position) => ({
            id: randomUUID(),
            resourceId: resource.id,
            ...status,
            position,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .run();
    });
    return resource;
  }

  async readTaskBoard(projectId: string, resourceId: string) {
    const resource = this.getResource(projectId, resourceId);
    const project = this.get(projectId);
    const workspaces = this.db
      .select()
      .from(projectWorkspaces)
      .where(eq(projectWorkspaces.projectId, projectId))
      .all();
    await this.syncAgentStates(resourceId);
    const tasks = this.db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.resourceId, resourceId))
      .all()
      .sort((a, b) => a.position - b.position);
    const taskIds = new Set(tasks.map((task) => task.id));
    return {
      resource,
      project,
      workspaces,
      statuses: this.db
        .select()
        .from(projectTaskStatuses)
        .where(eq(projectTaskStatuses.resourceId, resourceId))
        .all()
        .sort((a, b) => a.position - b.position),
      tasks,
      dependencies: this.db
        .select()
        .from(projectTaskDependencies)
        .all()
        .filter(
          (dependency) =>
            taskIds.has(dependency.taskId) &&
            taskIds.has(dependency.dependsOnTaskId),
        ),
    };
  }

  createTaskStatus(
    projectId: string,
    resourceId: string,
    input: { name?: string; color?: string },
  ): ProjectTaskStatus {
    this.getResource(projectId, resourceId);
    const name = this.validateTaskText(input.name, 'Status name', 80);
    const statuses = this.db
      .select()
      .from(projectTaskStatuses)
      .where(eq(projectTaskStatuses.resourceId, resourceId))
      .all();
    const now = Date.now();
    const status: ProjectTaskStatus = {
      id: randomUUID(),
      resourceId,
      name,
      color: this.validateColor(input.color),
      kind: 'custom',
      position: Math.max(-1, ...statuses.map((item) => item.position)) + 1,
      system: false,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(projectTaskStatuses).values(status).run();
    return status;
  }

  updateTaskStatus(
    projectId: string,
    resourceId: string,
    statusId: string,
    input: { name?: string; color?: string; position?: number },
  ): ProjectTaskStatus {
    this.getResource(projectId, resourceId);
    const status = this.requireTaskStatus(resourceId, statusId);
    const updated: ProjectTaskStatus = {
      ...status,
      name:
        input.name === undefined
          ? status.name
          : this.validateTaskText(input.name, 'Status name', 80),
      color:
        input.color === undefined
          ? status.color
          : this.validateColor(input.color),
      position:
        typeof input.position === 'number' && Number.isInteger(input.position)
          ? Math.max(0, input.position)
          : status.position,
      updatedAt: Date.now(),
    };
    this.db
      .update(projectTaskStatuses)
      .set(updated)
      .where(eq(projectTaskStatuses.id, statusId))
      .run();
    return updated;
  }

  deleteTaskStatus(projectId: string, resourceId: string, statusId: string) {
    this.getResource(projectId, resourceId);
    const status = this.requireTaskStatus(resourceId, statusId);
    if (status.system)
      throw new ConflictException('System task statuses cannot be deleted');
    const fallback = this.db
      .select()
      .from(projectTaskStatuses)
      .where(eq(projectTaskStatuses.resourceId, resourceId))
      .all()
      .find((item) => item.kind === 'unassigned');
    if (!fallback) throw new ConflictException('Unassigned status is missing');
    const now = Date.now();
    this.db.transaction((tx) => {
      tx.update(projectTasks)
        .set({ statusId: fallback.id, updatedAt: now })
        .where(eq(projectTasks.statusId, status.id))
        .run();
      tx.delete(projectTaskStatuses)
        .where(eq(projectTaskStatuses.id, status.id))
        .run();
    });
    return { ok: true, fallbackStatusId: fallback.id };
  }

  createTask(
    projectId: string,
    resourceId: string,
    input: {
      title?: string;
      description?: string;
      priority?: string;
      dueAt?: number | null;
      labels?: string[];
      linkedFilePath?: string | null;
      parentTaskId?: string | null;
      workspacePath?: string | null;
      executionMode?: string;
      estimateMinutes?: number;
      startAt?: number | null;
      validationCriteria?: string;
      dependencyIds?: string[];
      subtaskStatus?: string;
    },
  ): ProjectTask {
    this.getResource(projectId, resourceId);
    const fallback = this.db
      .select()
      .from(projectTaskStatuses)
      .where(eq(projectTaskStatuses.resourceId, resourceId))
      .all()
      .find((item) => item.kind === 'unassigned');
    if (!fallback) throw new ConflictException('Unassigned status is missing');
    const tasks = this.db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.statusId, fallback.id))
      .all();
    const priorities = new Set(['low', 'normal', 'high', 'urgent']);
    if (input.priority && !priorities.has(input.priority))
      throw new BadRequestException('Invalid priority');
    const parent = input.parentTaskId
      ? this.requireTask(resourceId, input.parentTaskId)
      : null;
    if (parent?.parentTaskId)
      throw new BadRequestException('A subtask cannot contain subtasks');
    const now = Date.now();
    const task: ProjectTask = {
      id: randomUUID(),
      resourceId,
      statusId: parent?.statusId ?? fallback.id,
      title: this.validateTaskText(input.title, 'Task title', 200),
      description: input.description?.trim().slice(0, 10_000) ?? '',
      priority: input.priority ?? 'normal',
      parentTaskId: input.parentTaskId ?? null,
      subtaskStatus: 'todo',
      workspacePath: this.validateTaskWorkspace(projectId, input.workspacePath),
      executionMode: input.executionMode === 'agent' ? 'agent' : 'manual',
      agentState: input.executionMode === 'agent' ? 'ready' : 'manual',
      estimateMinutes: Math.max(0, Math.trunc(input.estimateMinutes ?? 0)),
      startAt: input.startAt ?? null,
      dueAt: input.dueAt ?? null,
      validationCriteria:
        input.validationCriteria?.trim().slice(0, 10_000) ?? '',
      labels: (input.labels ?? [])
        .map((label) => label.trim())
        .filter(Boolean)
        .slice(0, 20),
      linkedThreadId: null,
      linkedSimpleChatId: null,
      linkedFilePath: input.linkedFilePath?.trim() || null,
      position: Math.max(-1, ...tasks.map((item) => item.position)) + 1,
      createdAt: now,
      updatedAt: now,
    };
    this.db.transaction((tx) => {
      tx.insert(projectTasks).values(task).run();
      for (const dependencyId of this.validateDependencyIds(
        resourceId,
        task.id,
        parent ? [] : input.dependencyIds,
      ))
        tx.insert(projectTaskDependencies)
          .values({
            taskId: task.id,
            dependsOnTaskId: dependencyId,
            createdAt: now,
          })
          .run();
    });
    return task;
  }

  updateTask(
    projectId: string,
    resourceId: string,
    taskId: string,
    input: Partial<{
      title: string;
      description: string;
      priority: string;
      dueAt: number | null;
      labels: string[];
      statusId: string;
      position: number;
      linkedThreadId: string | null;
      linkedSimpleChatId: string | null;
      linkedFilePath: string | null;
      parentTaskId: string | null;
      workspacePath: string | null;
      executionMode: string;
      agentState: string;
      estimateMinutes: number;
      startAt: number | null;
      validationCriteria: string;
      dependencyIds: string[];
      subtaskStatus: string;
    }>,
  ): ProjectTask {
    this.getResource(projectId, resourceId);
    const task = this.requireTask(resourceId, taskId);
    if (input.statusId) this.requireTaskStatus(resourceId, input.statusId);
    if (input.parentTaskId) {
      if (input.parentTaskId === task.id)
        throw new BadRequestException('A task cannot be its own parent');
      const parent = this.requireTask(resourceId, input.parentTaskId);
      if (parent.parentTaskId)
        throw new BadRequestException('A subtask cannot contain subtasks');
    }
    const effectiveParentId =
      input.parentTaskId !== undefined ? input.parentTaskId : task.parentTaskId;
    const subtaskStatuses = new Set([
      'todo',
      'started',
      'review',
      'done',
      'cancelled',
    ]);
    if (
      input.subtaskStatus !== undefined &&
      (!effectiveParentId || !subtaskStatuses.has(input.subtaskStatus))
    )
      throw new BadRequestException('Invalid subtask status');
    if (effectiveParentId && input.dependencyIds?.length)
      throw new BadRequestException('Subtasks cannot have dependencies');
    if (input.statusId) {
      const requestedStatus = this.requireTaskStatus(
        resourceId,
        input.statusId,
      );
      if (!effectiveParentId && requestedStatus.kind === 'done') {
        const unfinished = this.db
          .select()
          .from(projectTasks)
          .where(eq(projectTasks.parentTaskId, task.id))
          .all()
          .filter(
            (child) => !['done', 'cancelled'].includes(child.subtaskStatus),
          );
        if (unfinished.length)
          throw new ConflictException(
            'Complete or cancel every subtask before completing this task',
          );
      }
    }
    const priorities = new Set(['low', 'normal', 'high', 'urgent']);
    if (input.priority && !priorities.has(input.priority))
      throw new BadRequestException('Invalid priority');
    const updated: ProjectTask = {
      ...task,
      ...(input.title !== undefined
        ? { title: this.validateTaskText(input.title, 'Task title', 200) }
        : {}),
      ...(input.description !== undefined
        ? { description: input.description.trim().slice(0, 10_000) }
        : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.parentTaskId !== undefined
        ? { parentTaskId: input.parentTaskId }
        : {}),
      ...(input.subtaskStatus !== undefined
        ? { subtaskStatus: input.subtaskStatus }
        : {}),
      ...(input.workspacePath !== undefined
        ? {
            workspacePath: this.validateTaskWorkspace(
              projectId,
              input.workspacePath,
            ),
          }
        : {}),
      ...(input.executionMode !== undefined
        ? {
            executionMode: input.executionMode === 'agent' ? 'agent' : 'manual',
            agentState:
              input.executionMode === 'agent'
                ? task.linkedThreadId
                  ? task.agentState
                  : 'ready'
                : 'manual',
          }
        : {}),
      ...(input.agentState !== undefined
        ? { agentState: input.agentState }
        : {}),
      ...(input.estimateMinutes !== undefined
        ? { estimateMinutes: Math.max(0, Math.trunc(input.estimateMinutes)) }
        : {}),
      ...(input.startAt !== undefined ? { startAt: input.startAt } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
      ...(input.validationCriteria !== undefined
        ? {
            validationCriteria: input.validationCriteria
              .trim()
              .slice(0, 10_000),
          }
        : {}),
      ...(input.labels !== undefined
        ? {
            labels: input.labels
              .map((label) => label.trim())
              .filter(Boolean)
              .slice(0, 20),
          }
        : {}),
      ...(input.statusId !== undefined ? { statusId: input.statusId } : {}),
      ...(input.position !== undefined
        ? { position: Math.max(0, Math.trunc(input.position)) }
        : {}),
      ...(input.linkedThreadId !== undefined
        ? { linkedThreadId: input.linkedThreadId }
        : {}),
      ...(input.linkedSimpleChatId !== undefined
        ? { linkedSimpleChatId: input.linkedSimpleChatId }
        : {}),
      ...(input.linkedFilePath !== undefined
        ? { linkedFilePath: input.linkedFilePath?.trim() || null }
        : {}),
      updatedAt: Date.now(),
    };
    this.db.transaction((tx) => {
      tx.update(projectTasks)
        .set(updated)
        .where(eq(projectTasks.id, task.id))
        .run();
      if (input.dependencyIds !== undefined) {
        tx.delete(projectTaskDependencies)
          .where(eq(projectTaskDependencies.taskId, task.id))
          .run();
        if (!effectiveParentId)
          for (const dependencyId of this.validateDependencyIds(
            resourceId,
            task.id,
            input.dependencyIds,
          ))
            tx.insert(projectTaskDependencies)
              .values({
                taskId: task.id,
                dependsOnTaskId: dependencyId,
                createdAt: Date.now(),
              })
              .run();
      }
    });
    return updated;
  }

  deleteTask(projectId: string, resourceId: string, taskId: string) {
    this.getResource(projectId, resourceId);
    const task = this.requireTask(resourceId, taskId);
    this.db.transaction((tx) => {
      tx.delete(projectTasks)
        .where(eq(projectTasks.parentTaskId, task.id))
        .run();
      tx.delete(projectTasks).where(eq(projectTasks.id, task.id)).run();
    });
    return { ok: true };
  }

  async suggestTasks(projectId: string, resourceId: string, prompt: unknown) {
    this.getResource(projectId, resourceId);
    const request = this.validateTaskText(
      prompt,
      'Task planning request',
      4_000,
    );
    return { tasks: await this.simpleChat.suggestProjectTasks(request) };
  }

  private requireTaskStatus(resourceId: string, statusId: string) {
    const status = this.db
      .select()
      .from(projectTaskStatuses)
      .where(eq(projectTaskStatuses.id, statusId))
      .get();
    if (!status || status.resourceId !== resourceId)
      throw new NotFoundException('Task status not found');
    return status;
  }

  private requireTask(resourceId: string, taskId: string) {
    const task = this.db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.id, taskId))
      .get();
    if (!task || task.resourceId !== resourceId)
      throw new NotFoundException('Task not found');
    return task;
  }

  private validateTaskWorkspace(
    projectId: string,
    value: string | null | undefined,
  ) {
    if (!value) return null;
    const normalized = path.resolve(value);
    const allowed = this.db
      .select()
      .from(projectWorkspaces)
      .where(eq(projectWorkspaces.projectId, projectId))
      .all();
    if (
      !allowed.some(
        (workspace) =>
          normalized === workspace.path ||
          normalized.startsWith(`${workspace.path}${path.sep}`),
      )
    )
      throw new BadRequestException(
        'Task folder must be inside a project workspace',
      );
    return normalized;
  }

  private validateDependencyIds(
    resourceId: string,
    taskId: string,
    values: string[] | undefined,
  ) {
    const ids = [...new Set(values ?? [])].filter((id) => id !== taskId);
    for (const id of ids) {
      const dependency = this.requireTask(resourceId, id);
      if (dependency.parentTaskId)
        throw new BadRequestException('Subtasks cannot be dependencies');
      if (this.dependencyReaches(id, taskId, new Set()))
        throw new BadRequestException(
          'Task dependencies cannot contain a cycle',
        );
    }
    return ids;
  }

  private dependencyReaches(
    currentId: string,
    targetId: string,
    visited: Set<string>,
  ): boolean {
    if (currentId === targetId) return true;
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    return this.db
      .select()
      .from(projectTaskDependencies)
      .where(eq(projectTaskDependencies.taskId, currentId))
      .all()
      .some((dependency) =>
        this.dependencyReaches(dependency.dependsOnTaskId, targetId, visited),
      );
  }

  private async syncAgentStates(resourceId: string) {
    const snapshot = await this.metadata.read().catch(() => null);
    if (!snapshot) return;
    const states = new Map(
      snapshot.entries.map((entry) => [entry.thread.id, entry.thread.status]),
    );
    const review = this.db
      .select()
      .from(projectTaskStatuses)
      .where(eq(projectTaskStatuses.resourceId, resourceId))
      .all()
      .find((status) => status.kind === 'review');
    for (const task of this.db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.resourceId, resourceId))
      .all()) {
      if (
        !task.linkedThreadId ||
        !['running', 'waiting'].includes(task.agentState)
      )
        continue;
      const state = states.get(task.linkedThreadId);
      if (!state) continue;
      if (state.type === 'active') {
        const waiting = state.activeFlags.some((flag) =>
          ['waitingOnApproval', 'waitingOnUserInput'].includes(flag),
        );
        const next = waiting ? 'waiting' : 'running';
        if (task.agentState !== next)
          this.db
            .update(projectTasks)
            .set({ agentState: next, updatedAt: Date.now() })
            .where(eq(projectTasks.id, task.id))
            .run();
        continue;
      }
      this.db
        .update(projectTasks)
        .set({
          agentState: 'review',
          ...(task.parentTaskId
            ? { subtaskStatus: 'review' }
            : review
              ? { statusId: review.id }
              : {}),
          updatedAt: Date.now(),
        })
        .where(eq(projectTasks.id, task.id))
        .run();
    }
  }

  private validateTaskText(value: unknown, label: string, max: number) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text || text.length > max)
      throw new BadRequestException(
        `${label} must contain 1 to ${max} characters`,
      );
    return text;
  }

  private validateColor(value: unknown) {
    const colors = new Set([
      'slate',
      'blue',
      'amber',
      'red',
      'green',
      'purple',
    ]);
    return typeof value === 'string' && colors.has(value) ? value : 'slate';
  }

  getResource(projectId: string, resourceId: string): ProjectResource {
    this.get(projectId);
    const resource = this.db
      .select()
      .from(projectResources)
      .where(
        and(
          eq(projectResources.id, resourceId),
          eq(projectResources.projectId, projectId),
        ),
      )
      .get();
    if (!resource) throw new NotFoundException('Project resource not found');
    return resource;
  }

  updateResource(
    projectId: string,
    resourceId: string,
    input: { name?: string; projectId?: string },
  ): ProjectResource {
    const resource = this.getResource(projectId, resourceId);
    const targetProjectId = input.projectId ?? projectId;
    if (targetProjectId !== projectId) this.get(targetProjectId);
    const name = input.name === undefined ? resource.name : input.name.trim();
    if (!name) throw new BadRequestException('Resource name is required');
    if (name.length > 120)
      throw new BadRequestException('Resource name is too long');
    const updatedAt = Date.now();
    this.db
      .update(projectResources)
      .set({ projectId: targetProjectId, name, updatedAt })
      .where(eq(projectResources.id, resourceId))
      .run();
    return { ...resource, projectId: targetProjectId, name, updatedAt };
  }

  deleteResource(projectId: string, resourceId: string) {
    const resource = this.getResource(projectId, resourceId);
    this.db
      .delete(projectResources)
      .where(eq(projectResources.id, resource.id))
      .run();
    return { ok: true };
  }

  rename(id: string, nameValue: string): Project {
    const project = this.get(id);
    const name = this.validateName(nameValue);
    const updatedAt = Date.now();
    this.db
      .update(projects)
      .set({ name, updatedAt })
      .where(eq(projects.id, id))
      .run();
    return { ...project, name, updatedAt };
  }

  async remove(
    id: string,
    confirmation: string,
    deleteWorkspaceIds: string[] = [],
  ) {
    const project = this.get(id);
    if (confirmation !== project.name)
      throw new BadRequestException('Project confirmation does not match');
    const attached = this.db
      .select()
      .from(projectWorkspaces)
      .where(eq(projectWorkspaces.projectId, id))
      .all();
    const selectedWorkspaceIds = new Set(deleteWorkspaceIds);
    const workspacesToDelete = attached.filter((workspace) =>
      selectedWorkspaceIds.has(workspace.id),
    );
    const agents = this.db
      .select()
      .from(projectAgentThreads)
      .where(eq(projectAgentThreads.projectId, id))
      .all();
    const handled = new Set<string>();
    for (const agent of agents) {
      if (handled.has(agent.threadId)) continue;
      const preview = await this.deletion.previewDelete(agent.threadId);
      if (!preview.canDelete)
        throw new ConflictException(
          'One or more work agents cannot be deleted safely',
        );
      const result = await this.deletion.deleteThread(agent.threadId, {
        expectedThreadIds: preview.threadIds,
        expectedRunningThreadIds: preview.runningThreadIds,
        expectedPendingApprovalThreadIds: preview.pendingApprovalThreadIds,
        expectedPendingApprovalRequestIds: preview.pendingApprovals.map(
          (approval) => approval.requestId,
        ),
      });
      if (result.status !== 'completed')
        throw new ConflictException(
          'Project deletion stopped while deleting work agents',
        );
      preview.threadIds.forEach((threadId) => handled.add(threadId));
    }
    this.db.delete(projects).where(eq(projects.id, id)).run();
    for (const workspace of workspacesToDelete)
      await this.files.deletePath(workspace.path, true);
    return {
      ok: true,
      deletedWorkspaces: workspacesToDelete.map((workspace) => workspace.path),
      preservedWorkspaces: attached
        .filter((workspace) => !selectedWorkspaceIds.has(workspace.id))
        .map((workspace) => workspace.path),
    };
  }

  private requireWorkspace(
    projectId: string,
    workspacePath: string,
  ): ProjectWorkspace {
    const workspace = this.db
      .select()
      .from(projectWorkspaces)
      .where(eq(projectWorkspaces.path, workspacePath))
      .get();
    if (!workspace || workspace.projectId !== projectId)
      throw new BadRequestException(
        'Workspace is not attached to this project',
      );
    return workspace;
  }

  private get(id: string): Project {
    const project = this.db
      .select()
      .from(projects)
      .where(eq(projects.id, id))
      .get();
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  private validateName(value: string): string {
    const name = value?.trim();
    if (!name) throw new BadRequestException('Project name is required');
    this.files.validateEntryName(name);
    return name;
  }

  private ensurePrimaryWorkspaces(): void {
    const knownPaths = new Set(
      this.db
        .select({ path: projectWorkspaces.path })
        .from(projectWorkspaces)
        .all()
        .map((workspace) => workspace.path),
    );
    const now = Date.now();
    for (const project of this.db.select().from(projects).all()) {
      if (knownPaths.has(project.workspacePath)) continue;
      this.db
        .insert(projectWorkspaces)
        .values({
          id: randomUUID(),
          projectId: project.id,
          name: 'Principal',
          path: project.workspacePath,
          primary: true,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
    }
  }
}
