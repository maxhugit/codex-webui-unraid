/** Owns the SQLite connection, Drizzle instance, and drizzle-kit migrations. */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import * as schema from './schema';
import type { AppDatabase } from './database.constants';

const DEFAULT_DB_FILENAME = 'codex-webui.sqlite';
const MAX_ROWS_PER_PAGE = 100;
const SENSITIVE_NAME =
  /(password|secret|token|api[_-]?key|credential|private[_-]?key)/i;

interface SchemaObjectRow {
  name: string;
  type: 'table' | 'view';
  sql: string | null;
}

interface ColumnRow {
  cid: number;
  name: string;
  type: string;
  not_null: 0 | 1;
  dflt_value: string | null;
  pk: number;
}

interface ForeignKeyRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
}

interface MigrationJournal {
  entries: { idx: number; when: number; tag: string }[];
}

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
    const migration = this.getMigrationStatus();
    return {
      engine: 'SQLite',
      path: this.databasePath,
      connected: this.sqlite.open,
      readOnly: this.sqlite.readonly,
      databaseSizeBytes,
      walSizeBytes,
      sharedMemorySizeBytes,
      totalSizeBytes: databaseSizeBytes + walSizeBytes + sharedMemorySizeBytes,
      journalMode: String(
        this.sqlite.pragma('journal_mode', { simple: true }),
      ).toUpperCase(),
      foreignKeys: Boolean(
        this.sqlite.pragma('foreign_keys', { simple: true }),
      ),
      pageCount: Number(this.sqlite.pragma('page_count', { simple: true })),
      pageSizeBytes: Number(this.sqlite.pragma('page_size', { simple: true })),
      schemaVersion: migration.version,
      appliedMigrationCount: migration.count,
    };
  }

  /** Introspection uses fixed statements and SQLite table-valued pragmas only. */
  getSchema() {
    const objects = this.sqlite
      .prepare(
        `SELECT name, type, sql
         FROM sqlite_schema
         WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
         ORDER BY type, name`,
      )
      .all() as SchemaObjectRow[];
    return {
      objects: objects.map((object) => ({
        ...object,
        columns: (
          this.sqlite
            .prepare(
              `SELECT cid, name, type, "notnull" AS not_null, dflt_value, pk
               FROM pragma_table_info(?) ORDER BY cid`,
            )
            .all(object.name) as ColumnRow[]
        ).map((column) => ({
          position: column.cid,
          name: column.name,
          type: column.type,
          notNull: Boolean(column.not_null),
          defaultValue: column.dflt_value,
          primaryKeyPosition: column.pk,
        })),
        foreignKeys:
          object.type === 'table'
            ? (
                this.sqlite
                  .prepare(
                    `SELECT id, seq, "table", "from", "to", on_update, on_delete, match
                     FROM pragma_foreign_key_list(?) ORDER BY id, seq`,
                  )
                  .all(object.name) as ForeignKeyRow[]
              ).map((foreignKey) => ({
                id: foreignKey.id,
                sequence: foreignKey.seq,
                referencedTable: foreignKey.table,
                fromColumn: foreignKey.from,
                toColumn: foreignKey.to,
                onUpdate: foreignKey.on_update,
                onDelete: foreignKey.on_delete,
                match: foreignKey.match,
              }))
            : [],
      })),
    };
  }

  /** Paginated browsing only: no caller-provided SQL and no mutation surface. */
  readTable(
    table: unknown,
    pageValue: unknown,
    pageSizeValue: unknown,
    searchValue?: unknown,
  ) {
    if (typeof table !== 'string' || table.length === 0 || table.length > 128)
      throw new Error('Invalid database table');
    const known = this.sqlite
      .prepare(
        `SELECT name FROM sqlite_schema
         WHERE type IN ('table', 'view') AND name = ? AND name NOT LIKE 'sqlite_%'`,
      )
      .get(table) as { name: string } | undefined;
    if (!known) throw new Error('Unknown database table');
    const page = this.boundedInteger(pageValue, 1, 1_000_000, 1);
    const pageSize = this.boundedInteger(
      pageSizeValue,
      1,
      MAX_ROWS_PER_PAGE,
      25,
    );
    const identifier = `"${known.name.replaceAll('"', '""')}"`;
    const columns = (
      this.sqlite
        .prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid')
        .all(known.name) as { name: string }[]
    ).map((column) => column.name);
    if (
      searchValue !== undefined &&
      (typeof searchValue !== 'string' || searchValue.length > 200)
    )
      throw new Error('Invalid database search');
    const search = typeof searchValue === 'string' ? searchValue.trim() : '';
    const searchableColumns = columns.filter(
      (column) => !SENSITIVE_NAME.test(column),
    );
    const where =
      search && searchableColumns.length
        ? ` WHERE ${searchableColumns
            .map(
              (column) =>
                `CAST("${column.replaceAll('"', '""')}" AS TEXT) LIKE ? ESCAPE '\\'`,
            )
            .join(' OR ')}`
        : '';
    const escapedSearch = `%${search
      .replaceAll('\\', '\\\\')
      .replaceAll('%', '\\%')
      .replaceAll('_', '\\_')}%`;
    const parameters = search ? searchableColumns.map(() => escapedSearch) : [];
    const total = Number(
      (
        this.sqlite
          .prepare(`SELECT COUNT(*) AS total FROM ${identifier}${where}`)
          .get(...parameters) as {
          total: number | bigint;
        }
      ).total,
    );
    const rows = this.sqlite
      .prepare(`SELECT * FROM ${identifier}${where} LIMIT ? OFFSET ?`)
      .all(...parameters, pageSize, (page - 1) * pageSize) as Record<
      string,
      unknown
    >[];
    return {
      table: known.name,
      columns,
      rows: rows.map((row) => this.safeRow(row)),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      sensitiveValuesMasked: true,
      search,
    };
  }

  private boundedInteger(
    value: unknown,
    minimum: number,
    maximum: number,
    fallback: number,
  ): number {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)
      throw new Error('Invalid database pagination');
    return parsed;
  }

  private safeRow(row: Record<string, unknown>): Record<string, unknown> {
    const keyedSecret = Object.entries(row).some(
      ([name, value]) =>
        /^(key|name)$/i.test(name) &&
        typeof value === 'string' &&
        SENSITIVE_NAME.test(value),
    );
    return Object.fromEntries(
      Object.entries(row).map(([name, value]) => {
        if (
          SENSITIVE_NAME.test(name) ||
          (keyedSecret && /^(value|content)$/i.test(name))
        )
          return [name, '••••••'];
        if (typeof value === 'bigint') return [name, value.toString()];
        if (Buffer.isBuffer(value))
          return [name, `[BLOB ${value.length} bytes]`];
        if (typeof value === 'string' && value.length > 4_000)
          return [name, `${value.slice(0, 4_000)}…`];
        return [name, value];
      }),
    );
  }

  private resolveDatabasePath(): string {
    const explicitPath = this.config.get<string>('WEBUI_DB_PATH')?.trim();
    if (explicitPath) return explicitPath;

    const codexHome = this.config.get<string>('CODEX_HOME')?.trim();
    const baseDir = codexHome || join(homedir(), '.codex');
    return join(baseDir, DEFAULT_DB_FILENAME);
  }

  private getMigrationStatus(): { version: string; count: number } {
    try {
      const applied = this.sqlite
        .prepare(
          'SELECT COUNT(*) AS count, MAX(created_at) AS latest FROM __drizzle_migrations',
        )
        .get() as { count: number | bigint; latest: number | null };
      const count = Number(applied.count);
      const journal = JSON.parse(
        readFileSync(join(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
      ) as MigrationJournal;
      const entry = journal.entries.find(
        (candidate) => candidate.when === Number(applied.latest),
      );
      return {
        version: entry?.tag ?? (count > 0 ? `migration-${count}` : 'initial'),
        count,
      };
    } catch {
      return { version: 'unknown', count: 0 };
    }
  }

  /** Applies pending drizzle-kit migrations at application startup. */
  private runMigrations(): void {
    migrate(this.db, {
      migrationsFolder: join(process.cwd(), 'drizzle'),
    });
  }
}
