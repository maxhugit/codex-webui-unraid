import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface MigrationJournal {
  entries: Array<{ idx: number; when: number; tag: string }>;
}

it('keeps migration timestamps strictly increasing', () => {
  const journal = JSON.parse(
    readFileSync(join(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
  ) as MigrationJournal;

  for (let index = 1; index < journal.entries.length; index += 1) {
    const previous = journal.entries[index - 1];
    const current = journal.entries[index];
    expect(current.idx).toBe(previous.idx + 1);
    expect(current.when).toBeGreaterThan(previous.when);
  }
});
