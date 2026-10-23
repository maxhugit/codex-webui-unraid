import Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { describe, expect, it } from 'vitest';

describe('deliverable document migration', () => {
  it('converts legacy deliverable snapshots into independent document histories', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const migrations = readMigrationFiles({ migrationsFolder: 'drizzle' });
    const documentMigrationIndex = migrations.findIndex((migration) =>
      migration.sql.some((statement) =>
        statement.includes('CREATE TABLE `project_deliverable_documents`'),
      ),
    );
    expect(documentMigrationIndex).toBeGreaterThan(0);
    for (const migration of migrations.slice(0, documentMigrationIndex))
      for (const statement of migration.sql) sqlite.exec(statement);

    sqlite
      .prepare(
        `INSERT INTO projects
          (id, name, workspace_path, workspace_layout_version, mcp_server_ids,
           app_ids, sidebar_order, created_at, updated_at)
         VALUES ('p', 'Project', '/project', 1, '[]', '[]', '[]', 1, 1)`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO project_resources
          (id, project_id, type, name, config, created_at, updated_at)
         VALUES ('r', 'p', 'deliverable_board', 'Deliverables', '{}', 1, 1)`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO project_deliverables
          (id, resource_id, title, description, criteria, status, task_ids,
           conversations, version, created_at, updated_at)
         VALUES ('d', 'r', 'Package', '', '', 'validated', '[]', '[]', 3, 1, 3)`,
      )
      .run();
    const insertVersion = sqlite.prepare(
      `INSERT INTO project_deliverable_versions
        (id, deliverable_id, number, note, files, status, created_at)
       VALUES (?, 'd', ?, ?, ?, 'proposed', ?)`,
    );
    insertVersion.run(
      'legacy-1',
      1,
      'Initial',
      JSON.stringify([
        {
          name: 'report.docx',
          sourcePath: '/project/report.docx',
          snapshotPath: '/history/one/report.docx',
          size: 10,
          sha256: 'first',
        },
        {
          name: 'budget.xlsx',
          sourcePath: '/project/budget.xlsx',
          snapshotPath: '/history/one/budget.xlsx',
          size: 20,
          sha256: 'budget',
        },
      ]),
      10,
    );
    insertVersion.run(
      'legacy-2',
      2,
      'Revision',
      JSON.stringify([
        {
          name: 'report.docx',
          sourcePath: '/project/report.docx',
          snapshotPath: '/history/two/report.docx',
          size: 12,
          sha256: 'second',
        },
      ]),
      20,
    );

    for (const migration of migrations.slice(documentMigrationIndex))
      for (const statement of migration.sql) sqlite.exec(statement);

    const documents = sqlite
      .prepare(
        `SELECT name, current_version_number AS currentVersion
         FROM project_deliverable_documents ORDER BY name`,
      )
      .all() as Array<{ name: string; currentVersion: number }>;
    expect(documents).toEqual([
      { name: 'budget.xlsx', currentVersion: 1 },
      { name: 'report.docx', currentVersion: 2 },
    ]);
    const reportVersions = sqlite
      .prepare(
        `SELECT dv.number, dv.comment, dv.sha256
         FROM project_deliverable_document_versions dv
         JOIN project_deliverable_documents d ON d.id = dv.document_id
         WHERE d.name = 'report.docx' ORDER BY dv.number`,
      )
      .all();
    expect(reportVersions).toEqual([
      { number: 1, comment: 'Initial', sha256: 'first' },
      { number: 2, comment: 'Revision', sha256: 'second' },
    ]);
    expect(
      sqlite
        .prepare(
          `SELECT lifecycle_status FROM project_deliverables WHERE id = 'd'`,
        )
        .get(),
    ).toEqual({ lifecycle_status: 'finalized' });
    const snapshot = sqlite
      .prepare(
        `SELECT documents FROM project_deliverable_snapshots WHERE deliverable_id = 'd'`,
      )
      .get() as { documents: string };
    expect(JSON.parse(snapshot.documents)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ versionNumber: 1, sha256: 'budget' }),
        expect.objectContaining({ versionNumber: 2, sha256: 'second' }),
      ]),
    );
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    sqlite.close();
  });
  it('backfills the first valid legacy main task as the primary task', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const migrations = readMigrationFiles({ migrationsFolder: 'drizzle' });
    const primaryTaskMigrationIndex = migrations.findIndex((migration) =>
      migration.sql.some((statement) =>
        statement.includes('ADD `primary_task_id`'),
      ),
    );
    expect(primaryTaskMigrationIndex).toBeGreaterThan(0);
    for (const migration of migrations.slice(0, primaryTaskMigrationIndex))
      for (const statement of migration.sql) sqlite.exec(statement);
    sqlite.exec(`
      INSERT INTO projects (id, name, workspace_path, workspace_layout_version, mcp_server_ids, app_ids, sidebar_order, created_at, updated_at)
      VALUES ('p', 'Project', '/project', 1, '[]', '[]', '[]', 1, 1);
      INSERT INTO project_resources (id, project_id, type, name, config, created_at, updated_at)
      VALUES ('dboard', 'p', 'deliverable_board', 'Deliverables', '{}', 1, 1),
             ('tboard', 'p', 'task_board', 'Tasks', '{}', 1, 1);
      INSERT INTO project_task_statuses (id, resource_id, name, color, kind, position, is_system, created_at, updated_at)
      VALUES ('todo', 'tboard', 'To do', 'slate', 'unassigned', 0, 1, 1, 1);
      INSERT INTO project_tasks (id, resource_id, status_id, title, position, created_at, updated_at)
      VALUES ('task', 'tboard', 'todo', 'Main task', 0, 1, 1);
      INSERT INTO project_deliverables (id, resource_id, title, task_ids, conversations, created_at, updated_at)
      VALUES ('d', 'dboard', 'Package', '["task"]', '[]', 1, 1);
    `);
    for (const statement of migrations[primaryTaskMigrationIndex].sql)
      sqlite.exec(statement);
    expect(
      sqlite
        .prepare(
          'SELECT primary_task_id FROM project_deliverables WHERE id = ?',
        )
        .get('d'),
    ).toEqual({ primary_task_id: 'task' });
    sqlite.prepare('DELETE FROM project_tasks WHERE id = ?').run('task');
    expect(
      sqlite
        .prepare(
          'SELECT primary_task_id FROM project_deliverables WHERE id = ?',
        )
        .get('d'),
    ).toEqual({ primary_task_id: null });
    sqlite.close();
  });
  it('preserves existing human validation state when optional validation is introduced', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const migrations = readMigrationFiles({ migrationsFolder: 'drizzle' });
    const validationStateMigrationIndex = migrations.findIndex((migration) =>
      migration.sql.some((statement) =>
        statement.includes('ADD `validation_required`'),
      ),
    );
    expect(validationStateMigrationIndex).toBeGreaterThan(0);
    for (const migration of migrations.slice(0, validationStateMigrationIndex))
      for (const statement of migration.sql) sqlite.exec(statement);
    sqlite.exec(`
      INSERT INTO projects (id, name, workspace_path, workspace_layout_version, mcp_server_ids, app_ids, sidebar_order, created_at, updated_at)
      VALUES ('p', 'Project', '/project', 1, '[]', '[]', '[]', 1, 1);
      INSERT INTO project_resources (id, project_id, type, name, config, created_at, updated_at)
      VALUES ('r', 'p', 'deliverable_board', 'Deliverables', '{}', 1, 1);
      INSERT INTO project_deliverables (id, resource_id, title, task_ids, conversations, created_at, updated_at)
      VALUES ('d', 'r', 'Package', '[]', '[]', 1, 1);
      INSERT INTO project_deliverable_snapshots (id, deliverable_id, documents, created_by_name, created_at)
      VALUES ('s', 'd', '[]', 'Alice', 2);
      INSERT INTO project_deliverable_validations
        (id, deliverable_id, snapshot_id, status, requested_by_name, requested_at, decided_by_name, decided_at)
      VALUES ('v', 'd', 's', 'approved', 'Alice', 3, 'Bob', 4);
    `);
    for (const statement of migrations[validationStateMigrationIndex].sql)
      sqlite.exec(statement);
    expect(
      sqlite
        .prepare(
          `SELECT validation_required AS required,
                  validation_status AS status,
                  last_approved_snapshot_id AS snapshot
           FROM project_deliverables WHERE id = 'd'`,
        )
        .get(),
    ).toEqual({ required: 1, status: 'approved', snapshot: 's' });
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
    sqlite.close();
  });
});
