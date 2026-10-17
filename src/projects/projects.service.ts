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
import { projects, type Project } from '../database/schema';
import { FilesService } from '../files/files.service';
import { WorkspacesManagementService } from '../threads/workspaces-management.service';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly files: FilesService,
    private readonly workspaces: WorkspacesManagementService,
    @Inject(DRIZZLE_DB) private readonly db: AppDatabase,
  ) {}

  async list(): Promise<Project[]> {
    await this.importExistingWorkspaceDirectories();
    return this.db
      .select()
      .from(projects)
      .all()
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      );
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
      this.db.insert(projects).values(project).run();
      return project;
    } catch (error) {
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
      this.db
        .select({ workspacePath: projects.workspacePath })
        .from(projects)
        .all()
        .map((project) => project.workspacePath),
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
}
