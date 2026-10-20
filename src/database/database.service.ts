/** Owns the SQLite connection, Drizzle instance, and drizzle-kit migrations. */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import * as schema from './schema';
import type { AppDatabase } from './database.constants';

const DEFAULT_DB_FILENAME = 'codex-webui.sqlite';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly sqlite: Database.Database;
  readonly databasePath: string;
  readonly db: AppDatabase;

  constructor(private readonly config: ConfigService) {
    const dbPath = this.resolveDatabasePath();
    this.databasePath = dbPath;
    mkdirSync(dirname(dbPath), { recursive: true });

    this.sqlite = new Database(dbPath);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.sqlite.pragma('busy_timeout = 5000');
    this.db = drizzle(this.sqlite, { schema });

    this.runMigrations();
    this.logger.log(`SQLite database ready at ${dbPath}`);
  }

  onModuleDestroy(): void {
    this.sqlite.close();
  }

  /** Returns administrator-facing runtime information without exposing data. */
  getStatus() {
    const size = (path: string) => {
      try {
        return statSync(path).size;
      } catch {
        return 0;
      }
    };
    const databaseSizeBytes = size(this.databasePath);
    const walSizeBytes = size(`${this.databasePath}-wal`);
    const sharedMemorySizeBytes = size(`${this.databasePath}-shm`);
    return {
      engine: 'SQLite',
      path: this.databasePath,
      connected: this.sqlite.open,
      readOnly: this.sqlite.readonly,
      databaseSizeBytes,
      walSizeBytes,
      sharedMemorySizeBytes,
      totalSizeBytes:
        databaseSizeBytes + walSizeBytes + sharedMemorySizeBytes,
      journalMode: String(
        this.sqlite.pragma('journal_mode', { simple: true }),
      ).toUpperCase(),
      foreignKeys: Boolean(
        this.sqlite.pragma('foreign_keys', { simple: true }),
      ),
      pageCount: Number(this.sqlite.pragma('page_count', { simple: true })),
      pageSizeBytes: Number(
        this.sqlite.pragma('page_size', { simple: true }),
      ),
    };
  }

  private resolveDatabasePath(): string {
    const explicitPath = this.config.get<string>('WEBUI_DB_PATH')?.trim();
    if (explicitPath) return explicitPath;

    const codexHome = this.config.get<string>('CODEX_HOME')?.trim();
    const baseDir = codexHome || join(homedir(), '.codex');
    return join(baseDir, DEFAULT_DB_FILENAME);
  }

  /** Applies pending drizzle-kit migrations at application startup. */
  private runMigrations(): void {
    migrate(this.db, {
      migrationsFolder: join(process.cwd(), 'drizzle'),
    });
  }
}
