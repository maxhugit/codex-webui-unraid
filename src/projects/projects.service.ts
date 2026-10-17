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
  projectAgentThreads,
  projectWorkspaces,
  simpleChatThreads,
  type Project,
  type ProjectWorkspace,
  type ProjectResource,
} from '../database/schema';
import { FilesService } from '../files/files.service';
import { WorkspacesManagementService } from '../threads/workspaces-management.service';
import { ThreadMetadataService } from '../threads/thread-metadata.service';
import { ThreadWorkspaceOverridesService } from '../threads/thread-workspace-overrides.service';
import { ThreadsDeletionService } from '../threads/threads-deletion.service';
import { ThreadsService } from '../threads/threads.service';

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
        }>;
      }
    >
  > {
    this.ensurePrimaryWorkspaces();
    await this.migrateConversationAssociations();
    const workspaces = this.db.select().from(projectWorkspaces).all();
    const resources = this.db.select().from(projectResources).all();
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
            return {
              threadId,
              workspacePath,
              title:
                metadata.thread.name?.trim() || metadata.thread.preview.trim(),
              archived: metadata.archived,
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
  ) {
    const workspace = this.requireWorkspace(projectId, workspacePath);
    const threadIds = await this.threads.setThreadCwd(threadId, workspace.path);
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
    this.db.insert(projectResources).values(resource).run();
    return resource;
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
