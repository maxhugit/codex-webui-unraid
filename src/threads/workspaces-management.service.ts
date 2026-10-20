import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import * as path from 'node:path';
import { FilesService } from '../files/files.service';
import { ThreadsDeletionService } from './threads-deletion.service';
import { ThreadMetadataService } from './thread-metadata.service';
import { ThreadWorkspaceOverridesService } from './thread-workspace-overrides.service';

/** Coordinates workspace folder changes with Codex work-agent conversations. */
@Injectable()
export class WorkspacesManagementService {
  constructor(
    private readonly files: FilesService,
    private readonly metadata: ThreadMetadataService,
    private readonly deletion: ThreadsDeletionService,
    private readonly overrides: ThreadWorkspaceOverridesService,
  ) {}

  async rename(cwd: string, newName: string) {
    this.assertWorkspace(cwd);
    const result = await this.files.renameManagedWorkspace(cwd, newName);
    if (!result.newPath) throw new ConflictException('Workspace rename failed');
    const renamedPath = result.newPath;
    const oldPrefix = `${cwd}${path.sep}`;
    const remap = (value: string) =>
      value === cwd
        ? renamedPath
        : value.startsWith(oldPrefix)
          ? `${renamedPath}${value.slice(cwd.length)}`
          : null;

    try {
      const snapshot = await this.metadata.read();
      const effective = this.overrides.applyToThreads(
        snapshot.entries.map((entry) => entry.thread),
      );
      for (const thread of effective) {
        const next = thread.cwd ? remap(thread.cwd) : null;
        if (next) this.overrides.setMany([thread.id], next);
      }
      return { ok: true, oldPath: cwd, newPath: renamedPath };
    } catch (error) {
      await this.files.renameManagedWorkspace(renamedPath, path.basename(cwd));
      throw error;
    }
  }

  async remove(cwd: string, confirmation: string) {
    this.assertWorkspace(cwd);
    this.files.assertProjectPathMutable(cwd);
    if (confirmation !== path.basename(cwd))
      throw new BadRequestException('Workspace confirmation does not match');

    const snapshot = await this.metadata.read();
    const effective = this.overrides.applyToThreads(
      snapshot.entries.map((entry) => entry.thread),
    );
    const candidates = effective.filter(
      (thread) =>
        thread.cwd === cwd || thread.cwd?.startsWith(`${cwd}${path.sep}`),
    );
    const handled = new Set<string>();
    for (const thread of candidates) {
      if (handled.has(thread.id)) continue;
      const preview = await this.deletion.previewDelete(thread.id);
      if (!preview.canDelete)
        throw new ConflictException(
          'One or more work agents cannot be deleted safely',
        );
      const result = await this.deletion.deleteThread(thread.id, {
        expectedThreadIds: preview.threadIds,
        expectedRunningThreadIds: preview.runningThreadIds,
        expectedPendingApprovalThreadIds: preview.pendingApprovalThreadIds,
        expectedPendingApprovalRequestIds: preview.pendingApprovals.map(
          (approval) => approval.requestId,
        ),
      });
      if (result.status !== 'completed')
        throw new ConflictException(
          'Workspace deletion stopped while deleting work agents',
        );
      preview.threadIds.forEach((id) => handled.add(id));
    }

    await this.files.deleteManagedWorkspace(cwd);
    return { ok: true };
  }

  /** Repoints conversations whose persisted workspace disappeared from disk. */
  async reassignMissingWorkspace(
    missingCwd: string,
    replacementCwd: string,
  ): Promise<{ agents: number; simpleChats: number }> {
    const snapshot = await this.metadata.read();
    const effective = this.overrides.applyToThreads(
      snapshot.entries.map((entry) => entry.thread),
    );
    const affectedThreadIds = effective
      .filter(
        (thread) =>
          thread.cwd === missingCwd ||
          thread.cwd?.startsWith(`${missingCwd}${path.sep}`),
      )
      .map((thread) => thread.id);
    if (affectedThreadIds.length)
      this.overrides.setMany(affectedThreadIds, replacementCwd);

    return { agents: affectedThreadIds.length, simpleChats: 0 };
  }

  private assertWorkspace(cwd: string) {
    const normalized = path.resolve(cwd);
    if (path.dirname(normalized) !== '/workspaces')
      throw new BadRequestException(
        'Only direct workspace folders can be managed',
      );
  }
}
