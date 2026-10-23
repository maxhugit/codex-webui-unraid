import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { lstatSync, realpathSync } from 'node:fs';
import * as path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { requireProjectAccess } from '../auth/access-context';
import { DRIZZLE_DB, type AppDatabase } from '../database/database.constants';
import {
  projectActiveFolders,
  projectAgentThreads,
  projectDeliverables,
  projectResources,
  projectTasks,
  projectWorkspaceCopies,
  projectWorkspaceResources,
  projectWorkspaces,
  simpleChatThreads,
  type ProjectActiveFolder,
  type ProjectWorkspace,
} from '../database/schema';

export type ActiveFolderContext =
  | 'agent'
  | 'simple_chat'
  | 'task'
  | 'deliverable';
export type ActiveFolderState =
  | 'ready'
  | 'detached'
  | 'missing'
  | 'invalid'
  | 'revoked';

export interface ActiveFolderView {
  contextType: ActiveFolderContext;
  contextId: string;
  projectId: string;
  resourceId: string;
  resourceName: string | null;
  relativePath: string;
  effectivePath: string | null;
  state: ActiveFolderState;
}

export type ActiveFolderSelection = Pick<
  ActiveFolderView,
  'resourceId' | 'resourceName' | 'relativePath' | 'effectivePath' | 'state'
>;

/** Resolves stable active-folder references without granting additional access. */
@Injectable()
export class ActiveFoldersService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: AppDatabase) {}

  set(
    projectId: string,
    contextType: ActiveFolderContext,
    contextId: string,
    input: { resourceId: string; relativePath?: string | null },
    options: { allowUnboundAgent?: boolean } = {},
  ): ActiveFolderView {
    requireProjectAccess(projectId);
    this.assertContextProject(
      projectId,
      contextType,
      contextId,
      options.allowUnboundAgent === true,
    );
    const selection = this.validateSelection(projectId, input);
    const now = Date.now();
    this.db
      .insert(projectActiveFolders)
      .values({
        contextType,
        contextId,
        projectId,
        resourceId: selection.resourceId,
        relativePath: selection.relativePath,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          projectActiveFolders.contextType,
          projectActiveFolders.contextId,
        ],
        set: {
          projectId,
          resourceId: selection.resourceId,
          relativePath: selection.relativePath,
          updatedAt: now,
        },
      })
      .run();
    return this.get(contextType, contextId)!;
  }

  setFromAbsolutePath(
    projectId: string,
    contextType: ActiveFolderContext,
    contextId: string,
    absolutePath?: string | null,
    options: { allowUnboundAgent?: boolean } = {},
  ): ActiveFolderView {
    const selection = this.validateAbsoluteSelection(projectId, absolutePath);
    return this.set(
      projectId,
      contextType,
      contextId,
      {
        resourceId: selection.resourceId,
        relativePath: selection.relativePath,
      },
      options,
    );
  }

  validateSelection(
    projectId: string,
    input: { resourceId: string; relativePath?: string | null },
  ): ActiveFolderSelection {
    requireProjectAccess(projectId);
    const workspace = this.workspace(projectId, input.resourceId);
    const relativePath = this.normalizeRelativePath(input.relativePath);
    const inspected = this.inspect(workspace, relativePath);
    if (inspected.state !== 'ready')
      throw new ConflictException(
        'The active folder must exist as a regular directory inside the selected resource',
      );
    return {
      resourceId: workspace.id,
      resourceName: workspace.name,
      relativePath,
      ...inspected,
    };
  }

  validateAbsoluteSelection(
    projectId: string,
    absolutePath?: string | null,
  ): ActiveFolderSelection {
    requireProjectAccess(projectId);
    const workspace = absolutePath
      ? this.bestWorkspace(projectId, absolutePath)
      : this.primary(projectId);
    if (!workspace)
      throw new BadRequestException(
        'Active folder must belong to a resource attached to this project',
      );
    const relativePath = absolutePath
      ? path.relative(workspace.path, path.resolve(absolutePath))
      : '';
    return this.validateSelection(projectId, {
      resourceId: workspace.id,
      relativePath: relativePath.split(path.sep).join('/'),
    });
  }

  get(
    contextType: ActiveFolderContext,
    contextId: string,
  ): ActiveFolderView | null {
    const reference = this.db
      .select()
      .from(projectActiveFolders)
      .where(
        and(
          eq(projectActiveFolders.contextType, contextType),
          eq(projectActiveFolders.contextId, contextId),
        ),
      )
      .get();
    if (!reference) return null;
    requireProjectAccess(reference.projectId);
    return this.describe(reference);
  }

  resolve(contextType: ActiveFolderContext, contextId: string): string {
    const folder = this.get(contextType, contextId);
    if (!folder || folder.state !== 'ready' || !folder.effectivePath)
      throw new ConflictException(
        'The active folder is unresolved. Select an available project resource before starting a new operation.',
      );
    return folder.effectivePath;
  }

  /** A linked task is authoritative for its work agent. */
  resolveAgent(threadId: string): string | null {
    const task = this.db
      .select({ id: projectTasks.id })
      .from(projectTasks)
      .where(eq(projectTasks.linkedThreadId, threadId))
      .get();
    if (task) return this.resolve('task', task.id);
    return this.get('agent', threadId) ? this.resolve('agent', threadId) : null;
  }

  removeContext(contextType: ActiveFolderContext, contextId: string): void {
    this.db
      .delete(projectActiveFolders)
      .where(
        and(
          eq(projectActiveFolders.contextType, contextType),
          eq(projectActiveFolders.contextId, contextId),
        ),
      )
      .run();
  }

  /** Backfills absolute legacy paths after all workspace migrations are complete. */
  migrateLegacyReferences(): void {
    const now = Date.now();
    const insert = (
      contextType: ActiveFolderContext,
      contextId: string,
      projectId: string,
      legacyPath: string,
    ) => {
      if (this.getRaw(contextType, contextId)) return;
      const match = this.bestWorkspace(projectId, legacyPath);
      if (!match) return;
      const relativePath = path.relative(match.path, path.resolve(legacyPath));
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath))
        return;
      this.db
        .insert(projectActiveFolders)
        .values({
          contextType,
          contextId,
          projectId,
          resourceId: match.id,
          relativePath: relativePath.split(path.sep).join('/'),
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
    };

    for (const row of this.db.select().from(projectAgentThreads).all())
      insert('agent', row.threadId, row.projectId, row.workspacePath);
    for (const row of this.db.select().from(simpleChatThreads).all()) {
      if (row.projectId) insert('simple_chat', row.id, row.projectId, row.cwd);
    }
    for (const task of this.db.select().from(projectTasks).all()) {
      const resource = this.db
        .select({ projectId: projectResources.projectId })
        .from(projectResources)
        .where(eq(projectResources.id, task.resourceId))
        .get();
      if (!resource) continue;
      const primary = this.primary(resource.projectId);
      insert(
        'task',
        task.id,
        resource.projectId,
        task.workspacePath ?? primary.path,
      );
    }
    for (const item of this.db.select().from(projectDeliverables).all()) {
      const resource = this.db
        .select({ projectId: projectResources.projectId })
        .from(projectResources)
        .where(eq(projectResources.id, item.resourceId))
        .get();
      if (!resource) continue;
      insert(
        'deliverable',
        item.id,
        resource.projectId,
        path.join(this.primary(resource.projectId).path, 'livrables', item.id),
      );
    }
  }

  private describe(reference: ProjectActiveFolder): ActiveFolderView {
    const workspace = this.db
      .select()
      .from(projectWorkspaces)
      .where(eq(projectWorkspaces.id, reference.resourceId))
      .get();
    if (!workspace || workspace.projectId !== reference.projectId)
      return {
        ...reference,
        resourceName: null,
        effectivePath: null,
        state: 'detached',
      };
    if (!this.copySourceIsAvailable(workspace.id))
      return {
        ...reference,
        resourceName: workspace.name,
        effectivePath: null,
        state: 'revoked',
      };
    return {
      ...reference,
      resourceName: workspace.name,
      ...this.inspect(workspace, reference.relativePath),
    };
  }

  private inspect(
    workspace: ProjectWorkspace,
    relativePath: string,
  ): Pick<ActiveFolderView, 'effectivePath' | 'state'> {
    const root = path.resolve(workspace.path);
    const candidate = path.resolve(root, relativePath || '.');
    if (candidate !== root && !candidate.startsWith(root + path.sep))
      return { effectivePath: null, state: 'invalid' };
    try {
      let cursor = root;
      const components = relativePath.split('/').filter(Boolean);
      for (const component of ['', ...components]) {
        if (component) cursor = path.join(cursor, component);
        const stat = lstatSync(cursor);
        if (!stat.isDirectory() || stat.isSymbolicLink())
          return { effectivePath: null, state: 'invalid' };
      }
      const physicalRoot = realpathSync(root);
      const physicalCandidate = realpathSync(candidate);
      if (
        physicalCandidate !== physicalRoot &&
        !physicalCandidate.startsWith(physicalRoot + path.sep)
      )
        return { effectivePath: null, state: 'invalid' };
      return { effectivePath: candidate, state: 'ready' };
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT'
        ? { effectivePath: null, state: 'missing' }
        : { effectivePath: null, state: 'invalid' };
    }
  }

  private normalizeRelativePath(value?: string | null): string {
    const raw = (value ?? '').trim().replaceAll('\\', '/');
    if (!raw || raw === '.') return '';
    if (raw.includes('\0') || path.posix.isAbsolute(raw))
      throw new BadRequestException('Active folder path must be relative');
    const normalized = path.posix.normalize(raw).replace(/^\.\//, '');
    if (
      normalized === '..' ||
      normalized.startsWith('../') ||
      normalized.split('/').includes('..')
    )
      throw new BadRequestException('Active folder cannot leave its resource');
    return normalized === '.' ? '' : normalized;
  }

  private workspace(projectId: string, resourceId: string): ProjectWorkspace {
    const workspace = this.db
      .select()
      .from(projectWorkspaces)
      .where(
        and(
          eq(projectWorkspaces.id, resourceId),
          eq(projectWorkspaces.projectId, projectId),
        ),
      )
      .get();
    if (!workspace) {
      const remote = this.db
        .select({ id: projectWorkspaceResources.id })
        .from(projectWorkspaceResources)
        .where(
          and(
            eq(projectWorkspaceResources.id, resourceId),
            eq(projectWorkspaceResources.projectId, projectId),
          ),
        )
        .get();
      if (remote)
        throw new ConflictException(
          'A remote resource cannot be an execution folder. Create an explicit local working copy first.',
        );
      throw new NotFoundException('Project resource not found');
    }
    if (!this.copySourceIsAvailable(workspace.id))
      throw new ConflictException(
        'The source resource for this working copy is disabled or detached',
      );
    return workspace;
  }

  private copySourceIsAvailable(localWorkspaceId: string): boolean {
    const copy = this.db
      .select({
        sourceResourceId: projectWorkspaceCopies.sourceResourceId,
        state: projectWorkspaceCopies.state,
      })
      .from(projectWorkspaceCopies)
      .where(eq(projectWorkspaceCopies.localWorkspaceId, localWorkspaceId))
      .get();
    if (!copy) return true;
    if (copy.state !== 'ready') return false;
    return Boolean(
      this.db
        .select({ id: projectWorkspaceResources.id })
        .from(projectWorkspaceResources)
        .where(
          and(
            eq(projectWorkspaceResources.id, copy.sourceResourceId),
            eq(projectWorkspaceResources.enabled, true),
          ),
        )
        .get(),
    );
  }

  private primary(projectId: string): ProjectWorkspace {
    const workspace = this.db
      .select()
      .from(projectWorkspaces)
      .where(
        and(
          eq(projectWorkspaces.projectId, projectId),
          eq(projectWorkspaces.primary, true),
        ),
      )
      .get();
    if (!workspace) throw new ConflictException('Primary workspace is missing');
    return workspace;
  }

  private bestWorkspace(projectId: string, legacyPath: string) {
    const candidate = path.resolve(legacyPath);
    return this.db
      .select()
      .from(projectWorkspaces)
      .where(eq(projectWorkspaces.projectId, projectId))
      .all()
      .filter((workspace) => {
        const root = path.resolve(workspace.path);
        return candidate === root || candidate.startsWith(root + path.sep);
      })
      .sort((a, b) => b.path.length - a.path.length)[0];
  }

  private getRaw(contextType: ActiveFolderContext, contextId: string) {
    return this.db
      .select()
      .from(projectActiveFolders)
      .where(
        and(
          eq(projectActiveFolders.contextType, contextType),
          eq(projectActiveFolders.contextId, contextId),
        ),
      )
      .get();
  }

  private assertContextProject(
    projectId: string,
    contextType: ActiveFolderContext,
    contextId: string,
    allowUnboundAgent: boolean,
  ): void {
    let owner: string | null = null;
    if (contextType === 'agent') {
      owner =
        this.db
          .select({ projectId: projectAgentThreads.projectId })
          .from(projectAgentThreads)
          .where(eq(projectAgentThreads.threadId, contextId))
          .get()?.projectId ?? null;
      if (!owner && allowUnboundAgent) return;
    } else if (contextType === 'simple_chat') {
      owner =
        this.db
          .select({ projectId: simpleChatThreads.projectId })
          .from(simpleChatThreads)
          .where(eq(simpleChatThreads.id, contextId))
          .get()?.projectId ?? null;
    } else {
      const resourceId =
        contextType === 'task'
          ? this.db
              .select({ resourceId: projectTasks.resourceId })
              .from(projectTasks)
              .where(eq(projectTasks.id, contextId))
              .get()?.resourceId
          : this.db
              .select({ resourceId: projectDeliverables.resourceId })
              .from(projectDeliverables)
              .where(eq(projectDeliverables.id, contextId))
              .get()?.resourceId;
      owner = resourceId
        ? (this.db
            .select({ projectId: projectResources.projectId })
            .from(projectResources)
            .where(eq(projectResources.id, resourceId))
            .get()?.projectId ?? null)
        : null;
    }
    if (!owner) throw new NotFoundException('Active-folder context not found');
    if (owner !== projectId)
      throw new ConflictException(
        'Active-folder context belongs to another project',
      );
  }
}
