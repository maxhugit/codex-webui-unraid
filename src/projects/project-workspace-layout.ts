import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../database/database.constants';
import { projects, projectWorkspaces } from '../database/schema';

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
    const marker = path.join(target, '.webui', 'project.json');
    if (!created) {
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new ConflictException(
          'Primary workspace path is not a regular directory',
        );
      let owner: { projectId?: string };
      try {
        owner = JSON.parse(await fs.readFile(marker, 'utf8')) as {
          projectId?: string;
        };
      } catch {
        throw new ConflictException(
          `Primary workspace already exists without an ownership marker: ${target}`,
        );
      }
      if (owner.projectId !== id)
        throw new ConflictException(
          'Primary workspace belongs to another project',
        );
    }
    for (const relative of [
      '.webui',
      '.webui/knowledge',
      '.webui/history',
      'documents',
      'sources',
      'livrables',
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
      '.webui/project.json':
        JSON.stringify({ projectId: id, layoutVersion: 1 }, null, 2) + '\n',
      'AGENTS.md':
        '# Organisation du projet\n\nLes fichiers réservés à WebUI sont dans `.webui/`. Les documents de travail peuvent être rangés dans `documents/`, `sources/` et `livrables/`.\n\nLes instructions, connaissances et décisions partagées sont gérées depuis l’onglet Connaissances du projet et stockées dans `.webui/knowledge/`. WebUI les fournit aux conversations à chaque nouvel échange.\n',
      '.webui/knowledge/AGENTS.md': '# Instructions partagées\n',
      '.webui/knowledge/CONNAISSANCES.md': '# Connaissances du projet\n',
      '.webui/knowledge/DECISIONS.md': '# Décisions du projet\n',
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
      if (project.workspaceLayoutVersion >= 1) continue;
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
            workspaceLayoutVersion: 1,
            updatedAt: now,
          })
          .where(eq(projects.id, project.id))
          .run();
      });
    }
  }
}
