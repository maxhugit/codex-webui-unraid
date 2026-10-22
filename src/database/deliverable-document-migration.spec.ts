import Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { describe, expect, it } from 'vitest';

describe('deliverable document migration', () => {
  it('converts legacy deliverable snapshots into independent document histories', () => {
    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const migrations = readMigrationFiles({ migrationsFolder: 'drizzle' });
    for (const migration of migrations.slice(0, -2))
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

    for (const statement of migrations.at(-2)!.sql) sqlite.exec(statement);
    for (const statement of migrations.at(-1)!.sql) sqlite.exec(statement);

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
});
