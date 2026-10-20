import { ConfigService } from '@nestjs/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { DatabaseService } from './database.service';

let directory: string | undefined;
let database: DatabaseService | undefined;

afterEach(() => {
  database?.onModuleDestroy();
  database = undefined;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
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
