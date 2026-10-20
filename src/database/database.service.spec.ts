import { ConfigService } from '@nestjs/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { DatabaseService } from './database.service';

let directory: string | undefined;
let database: DatabaseService | undefined;

afterEach(() => {
  database?.onModuleDestroy();
  database = undefined;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

it('exposes schema and bounded read-only rows while masking secrets', () => {
  directory = mkdtempSync(join(tmpdir(), 'codex-webui-database-'));
  const path = join(directory, 'application.sqlite');
  database = new DatabaseService(new ConfigService({ WEBUI_DB_PATH: path }));
  database.db.run(
    sql`CREATE TABLE browser_test (id INTEGER PRIMARY KEY, name TEXT NOT NULL, api_token TEXT)`,
  );
  database.db.run(
    sql`INSERT INTO browser_test (name, api_token) VALUES ('visible', 'hidden')`,
  );

  const browserTable = database
    .getSchema()
    .objects.find((object) => object.name === 'browser_test');
  expect(browserTable?.type).toBe('table');
  expect(browserTable?.columns).toContainEqual(
    expect.objectContaining({ name: 'name', notNull: true }),
  );
  expect(database.readTable('browser_test', '1', '25')).toMatchObject({
    table: 'browser_test',
    total: 1,
    rows: [{ id: 1, name: 'visible', api_token: '••••••' }],
    sensitiveValuesMasked: true,
  });
  expect(() => database?.readTable('sqlite_master', 1, 25)).toThrow(
    'Unknown database table',
  );
  expect(() => database?.readTable('browser_test', 1, 101)).toThrow(
    'Invalid database pagination',
  );
});

it('reports the active SQLite path, storage size and safety settings', () => {
  directory = mkdtempSync(join(tmpdir(), 'codex-webui-database-'));
  const path = join(directory, 'application.sqlite');
  database = new DatabaseService(new ConfigService({ WEBUI_DB_PATH: path }));

  expect(database.getStatus()).toMatchObject({
    engine: 'SQLite',
    path,
    connected: true,
    readOnly: false,
    journalMode: 'WAL',
    foreignKeys: true,
  });
  expect(database.getStatus().databaseSizeBytes).toBeGreaterThan(0);
  expect(database.getStatus().totalSizeBytes).toBeGreaterThanOrEqual(
    database.getStatus().databaseSizeBytes,
  );
});
