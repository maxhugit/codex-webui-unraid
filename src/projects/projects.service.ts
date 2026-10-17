import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
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
  projectTaskActivity,
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

export type AutomationSchedule = 'manual' | 'daily' | 'weekly' | 'monthly';
export type ProjectAutomation = {
  id: string;
  name: string;
  instructions: string;
  schedule: AutomationSchedule;
  time: string;
  weekday: number;
  monthday: number;
  targetType: 'task_board' | 'workspace';
  targetId: string;
  mode: 'analysis' | 'proposal' | 'action';
  approvalRequired: boolean;
  active: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  createdAt: number;
  updatedAt: number;
};
export type AutomationRun = {
  id: string;
  automationId: string;
  status:
    | 'running'
    | 'success'
    | 'pending_approval'
    | 'approved'
    | 'rejected'
    | 'error';
  result: string;
  error: string;
  startedAt: number;
  finishedAt: number | null;
};

@Injectable()
export class ProjectsService implements OnModuleInit, OnModuleDestroy {
  private automationTimer?: NodeJS.Timeout;
  private readonly runningAutomationIds = new Set<string>();
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

  onModuleInit() {
    this.automationTimer = setInterval(
      () => void this.runDueAutomations(),
      60_000,
    );
    this.automationTimer.unref();
    void this.runDueAutomations();
  }

  onModuleDestroy() {
    if (this.automationTimer) clearInterval(this.automationTimer);
  }

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
    if (!['task_board', 'automation_board'].includes(input.type))
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
    const label =
      input.type === 'automation_board'
        ? 'Automatisations'
        : 'Gestionnaire de tâches';
    const defaultName =
      siblings.length === 0 ? label : `${label} ${siblings.length + 1}`;
    const name = input.name?.trim() || defaultName;
    if (name.length > 120)
      throw new BadRequestException('Resource name is too long');
    const now = Date.now();
    const resource: ProjectResource = {
      id: randomUUID(),
      projectId,
      type: input.type,
      name,
      config:
        input.type === 'automation_board' ? { automations: [], runs: [] } : {},
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
      { name: 'À valider', color: 'purple', kind: 'review', system: false },
      { name: 'Terminé', color: 'green', kind: 'done', system: false },
    ];
    this.db.transaction((tx) => {
      tx.insert(projectResources).values(resource).run();
      if (input.type !== 'task_board') return;
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

  async readResource(projectId: string, resourceId: string) {
    const resource = this.getResource(projectId, resourceId);
    if (resource.type === 'automation_board')
      return {
        resource,
        project: this.get(projectId),
        workspaces: this.db
          .select()
          .from(projectWorkspaces)
          .where(eq(projectWorkspaces.projectId, projectId))
          .all(),
        targets: this.db
          .select()
          .from(projectResources)
          .where(eq(projectResources.projectId, projectId))
          .all()
          .filter((item) => item.type === 'task_board'),
        ...this.automationConfig(resource),
      };
    return this.readTaskBoard(projectId, resourceId);
  }

  async readTaskBoard(projectId: string, resourceId: string) {
    const resource = this.getResource(projectId, resourceId);
    const project = this.get(projectId);
    // "À valider" used to be protected while top-level tasks could run an
    // agent. Agents now belong exclusively to subtasks, so existing boards
    // must expose this legacy column as a regular, removable status.
    const legacyReviewStatus = this.db
      .select()
      .from(projectTaskStatuses)
      .where(eq(projectTaskStatuses.resourceId, resourceId))
      .all()
      .find((status) => status.kind === 'review' && status.system);
    if (legacyReviewStatus)
      this.db
        .update(projectTaskStatuses)
        .set({ system: false, updatedAt: Date.now() })
        .where(eq(projectTaskStatuses.id, legacyReviewStatus.id))
        .run();
    const workspaces = this.db
      .select()
      .from(projectWorkspaces)
      .where(eq(projectWorkspaces.projectId, projectId))
      .all();
    await this.syncAgentStates(resourceId);
    this.recalculateAllParentEstimates(resourceId);
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
      activity: this.db
        .select()
        .from(projectTaskActivity)
        .where(eq(projectTaskActivity.resourceId, resourceId))
        .all()
        .sort((a, b) => b.createdAt - a.createdAt),
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
      progress?: number;
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
    const priorities = this.getTaskPriorities(resourceId);
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
      priority: parent ? parent.priority : (input.priority ?? 'normal'),
      parentTaskId: input.parentTaskId ?? null,
      subtaskStatus: 'todo',
      workspacePath: parent
        ? parent.workspacePath
        : this.validateTaskWorkspace(projectId, input.workspacePath),
      executionMode:
        parent && input.executionMode === 'agent' ? 'agent' : 'manual',
      agentState:
        parent && input.executionMode === 'agent' ? 'ready' : 'manual',
      estimateMinutes: Math.max(0, Math.trunc(input.estimateMinutes ?? 0)),
      progress: Math.min(100, Math.max(0, Math.trunc(input.progress ?? 0))),
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
      linkedFilePath: parent ? null : input.linkedFilePath?.trim() || null,
      position: Math.max(-1, ...tasks.map((item) => item.position)) + 1,
      createdAt: now,
      updatedAt: now,
    };
    this.validateTaskDateRange(task.startAt, task.dueAt, parent);
    this.db.transaction((tx) => {
      tx.insert(projectTasks).values(task).run();
      tx.insert(projectTaskActivity)
        .values({
          id: randomUUID(),
          resourceId,
          taskId: task.id,
          taskTitle: task.title,
          parentTaskId: task.parentTaskId,
          action: 'created',
          changes: {},
          createdAt: now,
        })
        .run();
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
    if (task.parentTaskId)
      this.recalculateParentEstimate(resourceId, task.parentTaskId);
    return task;
  }

  async updateTask(
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
      progress: number;
      startAt: number | null;
      validationCriteria: string;
      dependencyIds: string[];
      subtaskStatus: string;
    }>,
  ): Promise<ProjectTask> {
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
    const effectiveParent = effectiveParentId
      ? this.requireTask(resourceId, effectiveParentId)
      : null;
    const hasChildren =
      !effectiveParentId &&
      this.db
        .select({ id: projectTasks.id })
        .from(projectTasks)
        .where(eq(projectTasks.parentTaskId, task.id))
        .all().length > 0;
    if (input.executionMode === 'agent' && !effectiveParentId)
      throw new BadRequestException(
        'Only subtasks can be assigned to an agent',
      );
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
      const terminalSettings = this.getTaskBoardTerminalSettings(resourceId);
      if (
        !effectiveParentId &&
        terminalSettings.taskStatusIds.includes(requestedStatus.id)
      ) {
        const unfinished = this.db
          .select()
          .from(projectTasks)
          .where(eq(projectTasks.parentTaskId, task.id))
          .all()
          .filter(
            (child) =>
              !terminalSettings.subtaskStatuses.includes(child.subtaskStatus),
          );
        if (unfinished.length)
          throw new ConflictException(
            'Complete or cancel every subtask before completing this task',
          );
      }
    }
    const priorities = this.getTaskPriorities(resourceId);
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
      ...(effectiveParent
        ? { priority: effectiveParent.priority }
        : input.priority !== undefined
          ? { priority: input.priority }
          : {}),
      ...(input.parentTaskId !== undefined
        ? { parentTaskId: input.parentTaskId }
        : {}),
      ...(input.subtaskStatus !== undefined
        ? { subtaskStatus: input.subtaskStatus }
        : {}),
      ...(effectiveParent
        ? { workspacePath: effectiveParent.workspacePath }
        : input.workspacePath !== undefined
          ? {
              workspacePath: this.validateTaskWorkspace(
                projectId,
                input.workspacePath,
              ),
            }
          : {}),
      ...(input.executionMode !== undefined
        ? {
            executionMode:
              effectiveParentId && input.executionMode === 'agent'
                ? 'agent'
                : 'manual',
            agentState:
              effectiveParentId && input.executionMode === 'agent'
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
      ...(input.progress !== undefined && !hasChildren
        ? {
            progress: Math.min(100, Math.max(0, Math.trunc(input.progress))),
          }
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
      ...(effectiveParent
        ? { linkedFilePath: null }
        : input.linkedFilePath !== undefined
          ? { linkedFilePath: input.linkedFilePath?.trim() || null }
          : {}),
      updatedAt: Date.now(),
    };
    if (
      effectiveParentId &&
      this.getTaskBoardTerminalSettings(resourceId).subtaskStatuses.includes(
        updated.subtaskStatus,
      )
    )
      updated.progress = 100;
    this.validateTaskDateRange(updated.startAt, updated.dueAt, effectiveParent);
    if (!effectiveParentId) {
      const children = this.db
        .select()
        .from(projectTasks)
        .where(eq(projectTasks.parentTaskId, task.id))
        .all();
      for (const child of children)
        this.validateTaskDateRange(child.startAt, child.dueAt, updated);
    }
    const validatedAgentThreadId =
      effectiveParentId &&
      task.linkedThreadId &&
      input.agentState === 'validated' &&
      input.subtaskStatus === 'done'
        ? task.linkedThreadId
        : null;
    if (validatedAgentThreadId) {
      const preview = await this.deletion.previewDelete(validatedAgentThreadId);
      if (!preview.canDelete)
        throw new ConflictException(
          'The completed work agent cannot be deleted safely',
        );
      const result = await this.deletion.deleteThread(validatedAgentThreadId, {
        expectedThreadIds: preview.threadIds,
        expectedRunningThreadIds: preview.runningThreadIds,
        expectedPendingApprovalThreadIds: preview.pendingApprovalThreadIds,
        expectedPendingApprovalRequestIds: preview.pendingApprovals.map(
          (approval) => approval.requestId,
        ),
      });
      if (result.status !== 'completed')
        throw new ConflictException(
          'The subtask was not validated because its work agent could not be deleted',
        );
      updated.linkedThreadId = null;
    }
    this.db.transaction((tx) => {
      tx.update(projectTasks)
        .set(updated)
        .where(eq(projectTasks.id, task.id))
        .run();
      const changes = this.taskChanges(task, updated);
      if (Object.keys(changes).length)
        tx.insert(projectTaskActivity)
          .values({
            id: randomUUID(),
            resourceId,
            taskId: task.id,
            taskTitle: updated.title,
            parentTaskId: effectiveParentId,
            action: 'updated',
            changes,
            createdAt: updated.updatedAt,
          })
          .run();
      if (
        !effectiveParentId &&
        (input.workspacePath !== undefined || input.priority !== undefined)
      )
        tx.update(projectTasks)
          .set({
            workspacePath: updated.workspacePath,
            priority: updated.priority,
            linkedFilePath: null,
            updatedAt: Date.now(),
          })
          .where(eq(projectTasks.parentTaskId, task.id))
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
    if (task.parentTaskId)
      this.recalculateParentEstimate(resourceId, task.parentTaskId);
    if (effectiveParentId && effectiveParentId !== task.parentTaskId)
      this.recalculateParentEstimate(resourceId, effectiveParentId);
    if (!effectiveParentId)
      this.recalculateParentEstimate(resourceId, task.id, false);
    return this.requireTask(resourceId, task.id);
  }

  async deleteTask(projectId: string, resourceId: string, taskId: string) {
    this.getResource(projectId, resourceId);
    const task = this.requireTask(resourceId, taskId);
    const deletedTasks = [
      task,
      ...this.db
        .select()
        .from(projectTasks)
        .where(eq(projectTasks.parentTaskId, task.id))
        .all(),
    ];
    const linkedAgentIds = [
      ...new Set(
        deletedTasks
          .map((deletedTask) => deletedTask.linkedThreadId)
          .filter((threadId): threadId is string => Boolean(threadId)),
      ),
    ];
    for (const threadId of linkedAgentIds) {
      const preview = await this.deletion.previewDelete(threadId);
      if (!preview.canDelete)
        throw new ConflictException(
          'The task cannot be deleted because a linked work agent cannot be deleted safely',
        );
      const result = await this.deletion.deleteThread(threadId, {
        expectedThreadIds: preview.threadIds,
        expectedRunningThreadIds: preview.runningThreadIds,
        expectedPendingApprovalThreadIds: preview.pendingApprovalThreadIds,
        expectedPendingApprovalRequestIds: preview.pendingApprovals.map(
          (approval) => approval.requestId,
        ),
      });
      if (result.status !== 'completed')
        throw new ConflictException(
          'Task deletion stopped while deleting its linked work agent',
        );
    }
    this.db.transaction((tx) => {
      for (const deletedTask of deletedTasks)
        tx.insert(projectTaskActivity)
          .values({
            id: randomUUID(),
            resourceId,
            taskId: deletedTask.id,
            taskTitle: deletedTask.title,
            parentTaskId: deletedTask.parentTaskId,
            action: 'deleted',
            changes: {},
            createdAt: Date.now(),
          })
          .run();
      tx.delete(projectTasks)
        .where(eq(projectTasks.parentTaskId, task.id))
        .run();
      tx.delete(projectTasks).where(eq(projectTasks.id, task.id)).run();
    });
    if (task.parentTaskId)
      this.recalculateParentEstimate(resourceId, task.parentTaskId);
    return { ok: true };
  }

  private taskChanges(
    before: ProjectTask,
    after: ProjectTask,
  ): Record<string, { before: unknown; after: unknown }> {
    const ignored = new Set(['updatedAt', 'createdAt', 'resourceId']);
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const key of Object.keys(after) as Array<keyof ProjectTask>) {
      if (ignored.has(key)) continue;
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key]))
        changes[key] = { before: before[key], after: after[key] };
    }
    return changes;
  }

  private recalculateAllParentEstimates(resourceId: string) {
    const tasks = this.db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.resourceId, resourceId))
      .all();
    for (const parent of tasks.filter((task) => !task.parentTaskId))
      if (tasks.some((task) => task.parentTaskId === parent.id))
        this.recalculateParentEstimate(resourceId, parent.id);
  }

  private recalculateParentEstimate(
    resourceId: string,
    parentTaskId: string,
    resetWhenEmpty = true,
  ) {
    const parent = this.requireTask(resourceId, parentTaskId);
    const children = this.db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.parentTaskId, parentTaskId))
      .all();
    if (!children.length && !resetWhenEmpty) return;
    const estimateMinutes = children.reduce(
      (total, child) => total + child.estimateMinutes,
      0,
    );
    const progress = Math.round(
      children.reduce((total, child) => total + child.progress, 0) /
        Math.max(1, children.length),
    );
    if (
      parent.estimateMinutes === estimateMinutes &&
      parent.progress === progress
    )
      return;
    const now = Date.now();
    this.db.transaction((tx) => {
      tx.update(projectTasks)
        .set({ estimateMinutes, progress, updatedAt: now })
        .where(eq(projectTasks.id, parentTaskId))
        .run();
      const changes: Record<string, { before: unknown; after: unknown }> = {};
      if (parent.estimateMinutes !== estimateMinutes)
        changes.estimateMinutes = {
          before: parent.estimateMinutes,
          after: estimateMinutes,
        };
      if (parent.progress !== progress)
        changes.progress = { before: parent.progress, after: progress };
      if (Object.keys(changes).length)
        tx.insert(projectTaskActivity)
          .values({
            id: randomUUID(),
            resourceId,
            taskId: parent.id,
            taskTitle: parent.title,
            parentTaskId: null,
            action: 'updated',
            changes,
            createdAt: now,
          })
          .run();
    });
  }

  private getTaskBoardTerminalSettings(resourceId: string) {
    const resource = this.db
      .select()
      .from(projectResources)
      .where(eq(projectResources.id, resourceId))
      .get();
    const config =
      resource?.config && typeof resource.config === 'object'
        ? (resource.config as Record<string, unknown>)
        : {};
    const raw =
      config.taskBoardSettings &&
      typeof config.taskBoardSettings === 'object' &&
      !Array.isArray(config.taskBoardSettings)
        ? (config.taskBoardSettings as Record<string, unknown>)
        : {};
    const configuredTaskIds = raw.terminalStatusIds;
    const taskStatusIds = Array.isArray(configuredTaskIds)
      ? configuredTaskIds.filter(
          (value): value is string => typeof value === 'string',
        )
      : this.db
          .select()
          .from(projectTaskStatuses)
          .where(eq(projectTaskStatuses.resourceId, resourceId))
          .all()
          .filter((status) => status.kind === 'done')
          .map((status) => status.id);
    const allowedSubtaskStatuses = new Set([
      'todo',
      'started',
      'review',
      'done',
      'cancelled',
    ]);
    const subtaskStatuses = ['done', 'cancelled'].filter((value) =>
      allowedSubtaskStatuses.has(value),
    );
    return { taskStatusIds, subtaskStatuses };
  }

  private getTaskPriorities(resourceId: string): Set<string> {
    const resource = this.db
      .select()
      .from(projectResources)
      .where(eq(projectResources.id, resourceId))
      .get();
    const config = resource?.config as Record<string, unknown> | undefined;
    const board = config?.taskBoardSettings as
      | Record<string, unknown>
      | undefined;
    const configured = Array.isArray(board?.priorityOptions)
      ? board.priorityOptions
          .map((value) =>
            value && typeof value === 'object' && 'id' in value
              ? String(value.id).trim()
              : '',
          )
          .filter(Boolean)
      : [];
    return new Set(
      configured.length ? configured : ['low', 'normal', 'high', 'urgent'],
    );
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

  async replanTasks(projectId: string, resourceId: string, prompt: unknown) {
    this.getResource(projectId, resourceId);
    const request = String(prompt ?? '')
      .trim()
      .slice(0, 4_000);
    const tasks = this.db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.resourceId, resourceId))
      .all()
      .filter((task) => !task.parentTaskId);
    if (!tasks.length) return { tasks: [] };
    const ids = new Set(tasks.map((task) => task.id));
    const dependencies = this.db.select().from(projectTaskDependencies).all();
    const iso = (value: number | null) =>
      value ? new Date(value).toISOString().slice(0, 10) : '';
    const context = tasks.map((task) => ({
      id: task.id,
      title: task.title,
      priority: task.priority,
      estimateHours: task.estimateMinutes / 60,
      startDate: iso(task.startAt),
      dueDate: iso(task.dueAt),
      progress: task.progress,
      dependencyIds: dependencies
        .filter((dependency) => dependency.taskId === task.id)
        .map((dependency) => dependency.dependsOnTaskId)
        .filter((id) => ids.has(id)),
    }));
    const suggestions = await this.simpleChat.suggestProjectReplan(
      `Objectif ou contraintes complémentaires : ${request || 'Optimiser le planning existant sans contrainte supplémentaire.'}\n\nTâches existantes :\n${JSON.stringify(context, null, 2)}`,
    );
    const date = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
      const parsed = new Date(`${value}T12:00:00`).getTime();
      return Number.isFinite(parsed) ? parsed : null;
    };
    return {
      tasks: suggestions
        .filter((suggestion) => ids.has(suggestion.taskId))
        .map((suggestion) => {
          const task = tasks.find((item) => item.id === suggestion.taskId)!;
          const hasSubtasks =
            this.db
              .select()
              .from(projectTasks)
              .where(eq(projectTasks.parentTaskId, task.id))
              .all().length > 0;
          return {
            ...suggestion,
            estimateHours: hasSubtasks
              ? task.estimateMinutes / 60
              : suggestion.estimateHours,
            startAt: date(suggestion.startDate),
            dueAt: date(suggestion.dueDate),
            dependencyIds: suggestion.dependencyIds.filter(
              (id) => ids.has(id) && id !== suggestion.taskId,
            ),
          };
        }),
    };
  }

  async taskAdvice(
    projectId: string,
    resourceId: string,
    rawMode: unknown,
    rawAvailableHours: unknown,
  ) {
    this.getResource(projectId, resourceId);
    const mode = rawMode === 'work' ? 'work' : 'analysis';
    const availableHours = Number(rawAvailableHours);
    if (
      mode === 'work' &&
      (!Number.isFinite(availableHours) ||
        availableHours <= 0 ||
        availableHours > 168)
    )
      throw new BadRequestException(
        'Available hours must be between 0 and 168',
      );
    const tasks = this.db
      .select()
      .from(projectTasks)
      .where(eq(projectTasks.resourceId, resourceId))
      .all();
    const statuses = this.db
      .select()
      .from(projectTaskStatuses)
      .where(eq(projectTaskStatuses.resourceId, resourceId))
      .all();
    const dependencies = this.db.select().from(projectTaskDependencies).all();
    const terminal = new Set(
      this.getTaskBoardTerminalSettings(resourceId).taskStatusIds,
    );
    const iso = (value: number | null) =>
      value ? new Date(value).toISOString().slice(0, 10) : '';
    const context = tasks.map((task) => ({
      id: task.id,
      parentTaskId: task.parentTaskId,
      title: task.title,
      description: task.description,
      status: task.parentTaskId
        ? task.subtaskStatus
        : (statuses.find((status) => status.id === task.statusId)?.name ?? ''),
      terminal: task.parentTaskId
        ? ['done', 'cancelled'].includes(task.subtaskStatus)
        : terminal.has(task.statusId),
      priority: task.priority,
      estimateHours: task.estimateMinutes / 60,
      progress: task.progress,
      startDate: iso(task.startAt),
      dueDate: iso(task.dueAt),
      labels: task.labels,
      executionMode: task.executionMode,
      validationCriteria: task.validationCriteria,
      dependencyIds: dependencies
        .filter((dependency) => dependency.taskId === task.id)
        .map((dependency) => dependency.dependsOnTaskId),
    }));
    return this.simpleChat.suggestTaskAdvice({
      mode,
      availableHours: mode === 'work' ? availableHours : null,
      today: new Date().toISOString().slice(0, 10),
      tasks: context,
    });
  }

  async suggestSubtasks(
    projectId: string,
    resourceId: string,
    taskId: string,
    input: {
      title?: unknown;
      description?: unknown;
      validationCriteria?: unknown;
    },
  ) {
    const resource = this.getResource(projectId, resourceId);
    const task = this.requireTask(resourceId, taskId);
    if (task.parentTaskId)
      throw new BadRequestException(
        'A subtask cannot be divided into subtasks',
      );
    const title = this.validateTaskText(
      input.title ?? task.title,
      'Task title',
      200,
    );
    const description = String(input.description ?? task.description)
      .trim()
      .slice(0, 10_000);
    const validationCriteria = String(
      input.validationCriteria ?? task.validationCriteria,
    )
      .trim()
      .slice(0, 10_000);
    const taskBoardSettings =
      resource.config &&
      typeof resource.config === 'object' &&
      !Array.isArray(resource.config) &&
      resource.config.taskBoardSettings &&
      typeof resource.config.taskBoardSettings === 'object' &&
      !Array.isArray(resource.config.taskBoardSettings)
        ? (resource.config.taskBoardSettings as Record<string, unknown>)
        : {};
    const configuredLabels = Array.isArray(taskBoardSettings.labels)
      ? taskBoardSettings.labels
          .map((label) =>
            label &&
            typeof label === 'object' &&
            !Array.isArray(label) &&
            typeof (label as Record<string, unknown>).name === 'string'
              ? String((label as Record<string, unknown>).name).trim()
              : '',
          )
          .filter(Boolean)
          .slice(0, 100)
      : [];
    const allowedLabels = new Map(
      configuredLabels.map((label) => [label.toLocaleLowerCase(), label]),
    );
    const labelsInstruction = configuredLabels.length
      ? `\nLabels disponibles : ${configuredLabels.join(', ')}. Pour chaque sous-tâche, propose zéro, un ou plusieurs labels pertinents exclusivement parmi cette liste. N'invente aucun label.`
      : `\nAucun label n'est configuré : retourne une liste labels vide pour chaque sous-tâche.`;
    const prompt = `Découpe la tâche suivante en sous-tâches concrètes, suffisamment petites pour être exécutées et validées séparément. Ne retourne pas la tâche principale elle-même. Ne crée aucune dépendance entre les sous-tâches. Propose entre 2 et 10 sous-tâches. Pour chacune, détermine si un agent IA peut raisonnablement la réaliser seul ou si elle doit rester manuelle.${labelsInstruction}\n\nTâche : ${title}\nDescription : ${description || 'Non précisée'}\nConditions de validation : ${validationCriteria || 'Non précisées'}`;
    const suggestions = await this.simpleChat.suggestProjectTasks(prompt);
    return {
      tasks: suggestions.slice(0, 10).map((suggestion) => ({
        ...suggestion,
        labels: [
          ...new Set(
            suggestion.labels
              .map((label) => allowedLabels.get(label.toLocaleLowerCase()))
              .filter((label): label is string => Boolean(label)),
          ),
        ],
        parentTitle: title,
        dependsOnTitles: [],
      })),
    };
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

  private validateTaskDateRange(
    startAt: number | null,
    dueAt: number | null,
    parent: Pick<ProjectTask, 'startAt' | 'dueAt'> | null,
  ) {
    if (startAt !== null && dueAt !== null && startAt > dueAt)
      throw new BadRequestException(
        'The start date cannot be after the end date',
      );
    if (!parent) return;
    if (
      (parent.startAt !== null &&
        startAt !== null &&
        startAt < parent.startAt) ||
      (parent.dueAt !== null && dueAt !== null && dueAt > parent.dueAt)
    )
      throw new BadRequestException(
        'A subtask must stay within its parent task date range',
      );
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

  private automationConfig(resource: ProjectResource): {
    automations: ProjectAutomation[];
    runs: AutomationRun[];
  } {
    const config = resource.config;
    return {
      automations: Array.isArray(config.automations)
        ? (config.automations as ProjectAutomation[])
        : [],
      runs: Array.isArray(config.runs) ? (config.runs as AutomationRun[]) : [],
    };
  }

  private saveAutomationConfig(
    resource: ProjectResource,
    automations: ProjectAutomation[],
    runs: AutomationRun[],
  ) {
    const updatedAt = Date.now();
    const config = {
      ...resource.config,
      automations,
      runs: runs.slice(0, 100),
    };
    this.db
      .update(projectResources)
      .set({ config, updatedAt })
      .where(eq(projectResources.id, resource.id))
      .run();
    return config;
  }

  private nextAutomationRun(item: ProjectAutomation, from = new Date()) {
    if (!item.active || item.schedule === 'manual') return null;
    const [hour, minute] = item.time.split(':').map(Number);
    const next = new Date(from);
    next.setSeconds(0, 0);
    next.setHours(
      Number.isFinite(hour) ? hour : 8,
      Number.isFinite(minute) ? minute : 0,
      0,
      0,
    );
    if (item.schedule === 'daily') {
      if (next <= from) next.setDate(next.getDate() + 1);
    } else if (item.schedule === 'weekly') {
      const delta = (item.weekday - next.getDay() + 7) % 7;
      next.setDate(next.getDate() + delta);
      if (next <= from) next.setDate(next.getDate() + 7);
    } else {
      next.setDate(Math.max(1, Math.min(28, item.monthday)));
      if (next <= from) next.setMonth(next.getMonth() + 1);
    }
    return next.getTime();
  }

  upsertAutomation(
    projectId: string,
    resourceId: string,
    input: Partial<ProjectAutomation>,
    automationId?: string,
  ) {
    const resource = this.getResource(projectId, resourceId);
    if (resource.type !== 'automation_board')
      throw new BadRequestException('Not an automation resource');
    const { automations, runs } = this.automationConfig(resource);
    const existing = automationId
      ? automations.find((item) => item.id === automationId)
      : undefined;
    if (automationId && !existing)
      throw new NotFoundException('Automation not found');
    const now = Date.now();
    const schedule: AutomationSchedule = [
      'daily',
      'weekly',
      'monthly',
    ].includes(String(input.schedule))
      ? (input.schedule as AutomationSchedule)
      : 'manual';
    const item: ProjectAutomation = {
      id: existing?.id ?? randomUUID(),
      name: this.validateTaskText(
        input.name ?? existing?.name,
        'Automation name',
        120,
      ),
      instructions: this.validateTaskText(
        input.instructions ?? existing?.instructions,
        'Automation instructions',
        6_000,
      ),
      schedule,
      time: /^\d{2}:\d{2}$/.test(String(input.time))
        ? String(input.time)
        : (existing?.time ?? '08:00'),
      weekday: Math.max(
        0,
        Math.min(6, Number(input.weekday ?? existing?.weekday ?? 1)),
      ),
      monthday: Math.max(
        1,
        Math.min(28, Number(input.monthday ?? existing?.monthday ?? 1)),
      ),
      targetType: input.targetType === 'workspace' ? 'workspace' : 'task_board',
      targetId: String(input.targetId ?? existing?.targetId ?? '').trim(),
      mode: ['proposal', 'action'].includes(String(input.mode))
        ? (input.mode as 'proposal' | 'action')
        : 'analysis',
      approvalRequired:
        input.mode === 'analysis' ? false : input.approvalRequired !== false,
      active: input.active ?? existing?.active ?? true,
      lastRunAt: existing?.lastRunAt ?? null,
      nextRunAt: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    item.nextRunAt = this.nextAutomationRun(item);
    const next = existing
      ? automations.map((value) => (value.id === item.id ? item : value))
      : [...automations, item];
    this.saveAutomationConfig(resource, next, runs);
    return item;
  }

  deleteAutomation(
    projectId: string,
    resourceId: string,
    automationId: string,
  ) {
    const resource = this.getResource(projectId, resourceId);
    const { automations, runs } = this.automationConfig(resource);
    this.saveAutomationConfig(
      resource,
      automations.filter((item) => item.id !== automationId),
      runs.filter((run) => run.automationId !== automationId),
    );
    return { ok: true };
  }

  async runAutomation(
    projectId: string,
    resourceId: string,
    automationId: string,
  ) {
    let resource = this.getResource(projectId, resourceId);
    const config = this.automationConfig(resource);
    const item = config.automations.find((value) => value.id === automationId);
    if (!item) throw new NotFoundException('Automation not found');
    if (this.runningAutomationIds.has(automationId))
      throw new ConflictException('Automation already running');
    this.runningAutomationIds.add(automationId);
    const run: AutomationRun = {
      id: randomUUID(),
      automationId,
      status: 'running',
      result: '',
      error: '',
      startedAt: Date.now(),
      finishedAt: null,
    };
    this.saveAutomationConfig(resource, config.automations, [
      run,
      ...config.runs,
    ]);
    try {
      let context = '';
      if (item.targetType === 'task_board') {
        const board = await this.readTaskBoard(projectId, item.targetId);
        context = JSON.stringify({
          statuses: board.statuses,
          tasks: board.tasks,
          dependencies: board.dependencies,
        });
      } else {
        const workspace = this.requireWorkspace(projectId, item.targetId);
        context = `Workspace autorisé : ${workspace.path}. Aucun contenu de fichier n'est transmis automatiquement.`;
      }
      run.result = await this.simpleChat.runProjectAutomation(
        `Automatisation du projet « ${this.get(projectId).name} ».\nMode : ${item.mode}.\nInstruction : ${item.instructions}\nContexte : ${context}\nProduis un rapport clair en français. Ne prétends pas avoir appliqué de modification.`,
      );
      run.status = item.mode === 'analysis' ? 'success' : 'pending_approval';
    } catch (error) {
      run.status = 'error';
      run.error = error instanceof Error ? error.message : 'Automation failed';
    } finally {
      this.runningAutomationIds.delete(automationId);
    }
    run.finishedAt = Date.now();
    item.lastRunAt = run.finishedAt;
    item.nextRunAt = this.nextAutomationRun(item, new Date(run.finishedAt));
    item.updatedAt = run.finishedAt;
    resource = this.getResource(projectId, resourceId);
    const latest = this.automationConfig(resource);
    this.saveAutomationConfig(
      resource,
      latest.automations.map((value) => (value.id === item.id ? item : value)),
      [run, ...latest.runs.filter((value) => value.id !== run.id)],
    );
    return { run };
  }

  reviewAutomationRun(
    projectId: string,
    resourceId: string,
    runId: string,
    decision: 'approved' | 'rejected',
  ) {
    const resource = this.getResource(projectId, resourceId);
    if (resource.type !== 'automation_board')
      throw new BadRequestException('Not an automation resource');
    const { automations, runs } = this.automationConfig(resource);
    const run = runs.find((value) => value.id === runId);
    if (!run) throw new NotFoundException('Automation run not found');
    if (run.status !== 'pending_approval')
      throw new ConflictException('Automation run is not awaiting approval');
    run.status = decision;
    this.saveAutomationConfig(resource, automations, runs);
    return { run };
  }

  private async runDueAutomations() {
    const now = Date.now();
    for (const resource of this.db.select().from(projectResources).all()) {
      if (resource.type !== 'automation_board') continue;
      const { automations } = this.automationConfig(resource);
      for (const item of automations)
        if (item.active && item.nextRunAt && item.nextRunAt <= now)
          await this.runAutomation(
            resource.projectId,
            resource.id,
            item.id,
          ).catch(() => undefined);
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
      'teal',
      'pink',
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
    input: {
      name?: string;
      projectId?: string;
      config?: Record<string, unknown>;
      labelRenames?: Array<{ from: string; to: string }>;
      removedLabels?: string[];
    },
  ): ProjectResource {
    const resource = this.getResource(projectId, resourceId);
    const targetProjectId = input.projectId ?? projectId;
    if (targetProjectId !== projectId) this.get(targetProjectId);
    const name = input.name === undefined ? resource.name : input.name.trim();
    if (!name) throw new BadRequestException('Resource name is required');
    if (name.length > 120)
      throw new BadRequestException('Resource name is too long');
    const config =
      input.config === undefined
        ? resource.config
        : this.validateResourceConfig(input.config);
    const updatedAt = Date.now();
    const labelRenames = new Map(
      (input.labelRenames ?? [])
        .slice(0, 50)
        .map((change) => [
          this.validateOptionalLabel(change.from),
          this.validateOptionalLabel(change.to),
        ]),
    );
    const removedLabels = new Set(
      (input.removedLabels ?? [])
        .slice(0, 50)
        .map((label) => this.validateOptionalLabel(label)),
    );
    this.db
      .update(projectResources)
      .set({ projectId: targetProjectId, name, config, updatedAt })
      .where(eq(projectResources.id, resourceId))
      .run();
    if (labelRenames.size || removedLabels.size) {
      for (const task of this.db
        .select()
        .from(projectTasks)
        .where(eq(projectTasks.resourceId, resourceId))
        .all()) {
        const labels = [
          ...new Set(
            task.labels
              .map((label) => labelRenames.get(label) ?? label)
              .filter((label) => !removedLabels.has(label)),
          ),
        ];
        if (JSON.stringify(labels) !== JSON.stringify(task.labels))
          this.db
            .update(projectTasks)
            .set({ labels, updatedAt })
            .where(eq(projectTasks.id, task.id))
            .run();
      }
    }
    if (input.config !== undefined)
      this.recalculateAllParentEstimates(resourceId);
    return {
      ...resource,
      projectId: targetProjectId,
      name,
      config,
      updatedAt,
    };
  }

  private validateResourceConfig(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new BadRequestException('Resource config must be an object');
    if (JSON.stringify(value).length > 20_000)
      throw new BadRequestException('Resource config is too large');
    return value as Record<string, unknown>;
  }

  private validateOptionalLabel(value: unknown): string {
    const label = typeof value === 'string' ? value.trim() : '';
    if (!label || label.length > 50)
      throw new BadRequestException('Label must contain 1 to 50 characters');
    return label;
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
