/** Privileged recovery/provisioning CLI. Read personal data from stdin, never from Git. */
require('reflect-metadata');
const { readFileSync } = require('node:fs');
const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const schema = require('../dist/database/schema');
const { ProjectsService } = require('../dist/projects/projects.service');

const path = process.env.WEBUI_DB_PATH;
if (!path)
  throw new Error('WEBUI_DB_PATH must identify an existing migrated database');
const input = JSON.parse(readFileSync(0, 'utf8'));
const sqlite = new Database(path, { fileMustExist: true });
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');
try {
  const result = sqlite.transaction(() => {
    const byEmail = sqlite
      .prepare('SELECT * FROM people WHERE email = ? COLLATE NOCASE')
      .get(String(input.email ?? '').trim());
    const byReference = sqlite
      .prepare('SELECT * FROM people WHERE reference = ? COLLATE NOCASE')
      .get(String(input.reference ?? '').trim());
    if (byEmail && byReference && byEmail.id !== byReference.id)
      throw new Error('Email and reference belong to different people');
    const existing = byEmail ?? byReference;
    const service = new ProjectsService(
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      drizzle(sqlite, { schema }),
    );
    const person = service.savePerson(input, existing?.id);
    const subject = input.identitySubject;
    if (subject !== undefined) {
      if (
        typeof subject !== 'string' ||
        !subject.trim() ||
        subject.length > 512
      )
        throw new Error('Invalid authentication subject');
      if (existing?.identity_subject && existing.identity_subject !== subject)
        throw new Error('This person is already linked to a different login');
      sqlite
        .prepare('UPDATE people SET identity_subject = ? WHERE id = ?')
        .run(subject, person.id);
    }
    return {
      id: person.id,
      created: !existing,
      role: person.role,
      identityLinked: !!(subject ?? existing?.identity_subject),
    };
  })();
  console.log(JSON.stringify(result));
} finally {
  sqlite.close();
}
