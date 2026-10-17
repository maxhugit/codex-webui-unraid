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

  async create(nameValue: string): Promise<Project> {
    const name = this.validateName(nameValue);
    const workspacePath = path.join('/workspaces', name);
    const existing = this.db
      .select()
      .from(projects)
      .where(eq(projects.workspacePath, workspacePath))
      .get();
    if (existing)
      throw new ConflictException('A project already uses this workspace');

    await this.files.createDirectory(workspacePath, false, false);
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
      await this.files.deleteManagedWorkspace(workspacePath).catch(() => {});
      throw error;
    }
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
