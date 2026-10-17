import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import { DRIZZLE_DB, type AppDatabase } from '../database/database.constants';
import {
  projects,
  projectWorkspaces,
  type Project,
  type ProjectWorkspace,
} from '../database/schema';
import { FilesService } from '../files/files.service';
import { WorkspacesManagementService } from '../threads/workspaces-management.service';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly files: FilesService,
    private readonly workspaces: WorkspacesManagementService,
    @Inject(DRIZZLE_DB) private readonly db: AppDatabase,
  ) {}

  async list(): Promise<Array<Project & { workspaces: ProjectWorkspace[] }>> {
    await this.importExistingWorkspaceDirectories();
    this.ensurePrimaryWorkspaces();
    const workspaces = this.db.select().from(projectWorkspaces).all();
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
      }));
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
    let reassignedSimpleChats = 0;
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
        reassignedSimpleChats += reassigned.simpleChats;
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

  async remove(id: string, confirmation: string) {
    const project = this.get(id);
    if (confirmation !== project.name)
      throw new BadRequestException('Project confirmation does not match');
    await this.workspaces.remove(
      project.workspacePath,
      path.basename(project.workspacePath),
    );
    this.db.delete(projects).where(eq(projects.id, id)).run();
    return { ok: true };
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

  /** Imports pre-project installations without moving or rewriting anything. */
  private async importExistingWorkspaceDirectories(): Promise<void> {
    const entries = await this.files.readDirectory('/workspaces');
    const known = new Set(
      [
        ...this.db
          .select({ path: projects.workspacePath })
          .from(projects)
          .all(),
        ...this.db
          .select({ path: projectWorkspaces.path })
          .from(projectWorkspaces)
          .all(),
      ].map((entry) => entry.path),
    );
    const now = Date.now();
    for (const entry of entries) {
      if (entry.type !== 'directory' || known.has(entry.path)) continue;
      this.db
        .insert(projects)
        .values({
          id: randomUUID(),
          name: path.basename(entry.path),
          workspacePath: entry.path,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
    }
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
