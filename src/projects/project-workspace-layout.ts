import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../database/database.constants';
import {
  projects,
  projectWorkspaces,
  projectResources,
  projectDeliverables,
  projectDeliverableVersions,
  projectDeliverableDocuments,
  projectDeliverableDocumentVersions,
} from '../database/schema';
import {
  WORKSPACE_LAYOUT_VERSION,
  PROJECT_SYSTEM_DIRECTORY,
  LEGACY_PROJECT_SYSTEM_DIRECTORY,
  PROJECT_CONTENT_DIRECTORIES,
  PROJECT_WORKSPACE_INSTRUCTIONS,
  LEGACY_PROJECT_WORKSPACE_INSTRUCTIONS,
} from './workspace-structure';

/** Files belong to the primary workspace; the database only records their location. */
export class ProjectWorkspaceLayout {
  constructor(
    private readonly db: AppDatabase,
    private readonly root = '/workspaces',
  ) {}

  primaryPath(id: string) {
    if (!id || path.basename(id) !== id || id === '.' || id === '..')
      throw new ConflictException('Invalid project identifier');
    return path.join(this.root, id);
  }

  async prepare(id: string): Promise<string> {
    const target = this.primaryPath(id);
    const owner = this.db
      .select()
      .from(projectWorkspaces)
      .where(eq(projectWorkspaces.path, target))
      .get();
    if (owner && owner.projectId !== id)
      throw new ConflictException(
        'Primary workspace path is already attached to another project',
      );
    await fs.mkdir(this.root, { recursive: true });
    const physicalTarget = path.join(await fs.realpath(this.root), id);
    const roots = [
      ...this.db
        .select()
        .from(projectWorkspaces)
        .all()
        .map((w) => ({ projectId: w.projectId, path: w.path })),
      ...this.db
        .select()
        .from(projects)
        .all()
        .map((p) => ({ projectId: p.id, path: p.workspacePath })),
    ];
    for (const root of roots) {
      if (root.projectId === id) continue;
      const physicalRoot = await fs
        .realpath(root.path)
        .catch(() => path.resolve(root.path));
      if (
        physicalTarget === physicalRoot ||
        physicalTarget.startsWith(physicalRoot + path.sep) ||
        physicalRoot.startsWith(physicalTarget + path.sep)
      )
        throw new ConflictException('Project workspaces cannot overlap');
    }
    let created = false;
    try {
      await fs.mkdir(target);
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    if (!created) {
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new ConflictException(
          'Primary workspace path is not a regular directory',
        );
      await this.migrateSystemDirectory(target, id);
    }
    for (const relative of [
      PROJECT_SYSTEM_DIRECTORY,
      `${PROJECT_SYSTEM_DIRECTORY}/knowledge`,
      `${PROJECT_SYSTEM_DIRECTORY}/history`,
      ...PROJECT_CONTENT_DIRECTORIES,
    ]) {
      const directory = path.join(target, relative);
      await fs.mkdir(directory, { recursive: true });
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new ConflictException(
          'Workspace layout contains a symbolic link',
        );
    }
    const files: Record<string, string> = {
      [`${PROJECT_SYSTEM_DIRECTORY}/project.json`]:
        JSON.stringify(
          { projectId: id, layoutVersion: WORKSPACE_LAYOUT_VERSION },
          null,
          2,
        ) + '\n',
      'AGENTS.md': PROJECT_WORKSPACE_INSTRUCTIONS,
      [`${PROJECT_SYSTEM_DIRECTORY}/knowledge/AGENTS.md`]:
        '# Instructions partagées\n',
      [`${PROJECT_SYSTEM_DIRECTORY}/knowledge/CONNAISSANCES.md`]:
        '# Connaissances du projet\n',
      [`${PROJECT_SYSTEM_DIRECTORY}/knowledge/DECISIONS.md`]:
        '# Décisions du projet\n',
    };
    for (const [relative, content] of Object.entries(files)) {
      try {
        await fs.writeFile(path.join(target, relative), content, {
          flag: 'wx',
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    return target;
  }

  async migrate(): Promise<void> {
    for (const project of this.db.select().from(projects).all()) {
      if (project.workspaceLayoutVersion >= WORKSPACE_LAYOUT_VERSION) continue;
      if (project.workspaceLayoutVersion === 1) {
        // Missing permanent roots are reported by reconciliation, never recreated.
        if (!(await this.statIfPresent(project.workspacePath))) continue;
        await this.migrateSystemDirectory(project.workspacePath, project.id);
        this.migrateHistoryReferences(project.id, project.workspacePath);
        continue;
      }
      const target = await this.prepare(project.id);
      const now = Date.now();
      this.db.transaction((tx) => {
        const attached = tx
          .select()
          .from(projectWorkspaces)
          .where(eq(projectWorkspaces.projectId, project.id))
          .all();
        if (
          !attached.some(
            (workspace) => workspace.path === project.workspacePath,
          )
        ) {
          tx.insert(projectWorkspaces)
            .values({
              id: randomUUID(),
              projectId: project.id,
              name: 'Ancien workspace',
              path: project.workspacePath,
              primary: false,
              createdAt: now,
              updatedAt: now,
            })
            .run();
        }
        tx.update(projectWorkspaces)
          .set({ primary: false })
          .where(eq(projectWorkspaces.projectId, project.id))
          .run();
        const existing = attached.find(
          (workspace) => workspace.path === target,
        );
        if (existing)
          tx.update(projectWorkspaces)
            .set({ primary: true, name: 'Principal' })
            .where(eq(projectWorkspaces.id, existing.id))
            .run();
        else
          tx.insert(projectWorkspaces)
            .values({
              id: randomUUID(),
              projectId: project.id,
              name: 'Principal',
              path: target,
              primary: true,
              createdAt: now,
              updatedAt: now,
            })
            .run();
        tx.update(projects)
          .set({
            workspacePath: target,
            workspaceLayoutVersion: WORKSPACE_LAYOUT_VERSION,
            updatedAt: now,
          })
          .where(eq(projects.id, project.id))
          .run();
      });
    }
  }

  private async statIfPresent(target: string) {
    try {
      return await fs.lstat(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async readMarker(directory: string, projectId: string) {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new ConflictException(
        `Workspace layout must use regular directories: ${directory}`,
      );
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(
        path.join(directory, 'project.json'),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 4096)
        throw new Error('Invalid ownership marker');
      const marker = JSON.parse(await handle.readFile('utf8')) as {
        projectId?: string;
        layoutVersion?: number;
      };
      if (marker.projectId !== projectId)
        throw new ConflictException(
          'Primary workspace belongs to another project',
        );
      if (![1, WORKSPACE_LAYOUT_VERSION].includes(marker.layoutVersion ?? 0))
        throw new ConflictException('Unsupported workspace layout version');
      return marker;
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new ConflictException(
        `Primary workspace has an invalid ownership marker: ${directory}`,
      );
    } finally {
      await handle?.close();
    }
  }

  /** Rename on the same volume; never merge two system directories. */
  private async migrateSystemDirectory(root: string, projectId: string) {
    const rootStat = await fs.lstat(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
      throw new ConflictException(
        'Primary workspace path is not a regular directory',
      );
    const legacy = path.join(root, LEGACY_PROJECT_SYSTEM_DIRECTORY);
    const destination = path.join(root, PROJECT_SYSTEM_DIRECTORY);
    const [oldStat, newStat] = await Promise.all([
      this.statIfPresent(legacy),
      this.statIfPresent(destination),
    ]);
    if (oldStat && newStat)
      throw new ConflictException(
        `Both .webui and .mergeron exist; restore a single owned system directory before retrying: ${root}`,
      );
    if (!oldStat && !newStat)
      throw new ConflictException(
        `Primary workspace already exists without an ownership marker: ${root}`,
      );
    const source = oldStat ? legacy : destination;
    const marker = await this.readMarker(source, projectId);
    // Validate the reserved subdirectories before moving any data.
    for (const name of ['knowledge', 'history']) {
      const directory = path.join(source, name);
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new ConflictException(
          `Workspace layout contains an invalid directory: ${directory}`,
        );
    }
    for (const name of PROJECT_CONTENT_DIRECTORIES) {
      const directory = path.join(root, name);
      const stat = await this.statIfPresent(directory);
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink()))
        throw new ConflictException(
          `Workspace layout contains an invalid directory: ${directory}`,
        );
    }
    if (oldStat) await fs.rename(legacy, destination);
    for (const name of PROJECT_CONTENT_DIRECTORIES)
      await fs.mkdir(path.join(root, name), { recursive: true });
    if (marker.layoutVersion !== WORKSPACE_LAYOUT_VERSION) {
      const temporary = path.join(destination, `.${randomUUID()}.tmp`);
      try {
        await fs.writeFile(
          temporary,
          JSON.stringify(
            { ...marker, layoutVersion: WORKSPACE_LAYOUT_VERSION },
            null,
            2,
          ) + '\n',
          { flag: 'wx', mode: 0o600 },
        );
        await fs.rename(temporary, path.join(destination, 'project.json'));
      } finally {
        await fs.rm(temporary, { force: true });
      }
    }
    const instructions = path.join(root, 'AGENTS.md');
    const instructionsStat = await this.statIfPresent(instructions);
    if (
      instructionsStat?.isFile() &&
      !instructionsStat.isSymbolicLink() &&
      (await fs.readFile(instructions, 'utf8')) ===
        LEGACY_PROJECT_WORKSPACE_INSTRUCTIONS
    ) {
      const temporary = path.join(root, `.${randomUUID()}.tmp`);
      try {
        await fs.writeFile(temporary, PROJECT_WORKSPACE_INSTRUCTIONS, {
          flag: 'wx',
        });
        await fs.rename(temporary, instructions);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    }
  }

  /** Replayable after a crash between the filesystem rename and this transaction. */
  private migrateHistoryReferences(projectId: string, root: string) {
    const legacy = path.join(root, LEGACY_PROJECT_SYSTEM_DIRECTORY);
    const destination = path.join(root, PROJECT_SYSTEM_DIRECTORY);
    const relocate = (value: string) =>
      value.startsWith(legacy + path.sep)
        ? destination + value.slice(legacy.length)
        : value;
    this.db.transaction((tx) => {
      const deliverables = tx
        .select({ id: projectDeliverables.id })
        .from(projectDeliverables)
        .innerJoin(
          projectResources,
          eq(projectResources.id, projectDeliverables.resourceId),
        )
        .where(eq(projectResources.projectId, projectId))
        .all();
      for (const deliverable of deliverables) {
        for (const version of tx
          .select()
          .from(projectDeliverableVersions)
          .where(eq(projectDeliverableVersions.deliverableId, deliverable.id))
          .all()) {
          const files = version.files.map((file) => ({
            ...file,
            snapshotPath: relocate(file.snapshotPath),
          }));
          if (
            files.some(
              (file, i) => file.snapshotPath !== version.files[i].snapshotPath,
            )
          )
            tx.update(projectDeliverableVersions)
              .set({ files })
              .where(eq(projectDeliverableVersions.id, version.id))
              .run();
        }
        for (const document of tx
          .select()
          .from(projectDeliverableDocuments)
          .where(eq(projectDeliverableDocuments.deliverableId, deliverable.id))
          .all()) {
          for (const version of tx
            .select()
            .from(projectDeliverableDocumentVersions)
            .where(
              eq(projectDeliverableDocumentVersions.documentId, document.id),
            )
            .all()) {
            const snapshotPath = relocate(version.snapshotPath);
            const onlyofficeChangesPath = version.onlyofficeChangesPath
              ? relocate(version.onlyofficeChangesPath)
              : null;
            if (
              snapshotPath !== version.snapshotPath ||
              onlyofficeChangesPath !== version.onlyofficeChangesPath
            )
              tx.update(projectDeliverableDocumentVersions)
                .set({ snapshotPath, onlyofficeChangesPath })
                .where(eq(projectDeliverableDocumentVersions.id, version.id))
                .run();
          }
        }
      }
      tx.update(projects)
        .set({ workspaceLayoutVersion: WORKSPACE_LAYOUT_VERSION })
        .where(eq(projects.id, projectId))
        .run();
    });
  }
}
