import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE_DB, type AppDatabase } from '../database/database.constants';
import { settings } from '../database/schema';
import type { v2 } from '../codex/codex-schema';

const CATEGORY = 'thread-workspace';
const KEY_PREFIX = 'thread-workspace:';

/** Persists WebUI workspace moves independently of immutable rollout metadata. */
@Injectable()
export class ThreadWorkspaceOverridesService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: AppDatabase) {}

  get(threadId: string): string | null {
    return (
      this.db
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, `${KEY_PREFIX}${threadId}`))
        .get()?.value ?? null
    );
  }

  setMany(threadIds: readonly string[], cwd: string): void {
    const now = Date.now();
    this.db.transaction((tx) => {
      for (const threadId of new Set(threadIds)) {
        const row = {
          key: `${KEY_PREFIX}${threadId}`,
          value: cwd,
          type: 'string',
          category: CATEGORY,
          description: 'Workspace selected for this Codex conversation',
          defaultValue: '',
          constraints: '{}',
          updatedAt: now,
        };
        tx.insert(settings)
          .values(row)
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: cwd, updatedAt: now },
          })
          .run();
      }
    });
  }

  applyToThreads(threads: readonly v2.Thread[]): v2.Thread[] {
    const overrides = new Map(
      this.db
        .select({ key: settings.key, value: settings.value })
        .from(settings)
        .where(eq(settings.category, CATEGORY))
        .all()
        .flatMap((row) =>
          row.value
            ? [[row.key.slice(KEY_PREFIX.length), row.value] as const]
            : [],
        ),
    );
    return threads.map((thread) => {
      const cwd = overrides.get(thread.id);
      return cwd ? { ...thread, cwd } : thread;
    });
  }
}
