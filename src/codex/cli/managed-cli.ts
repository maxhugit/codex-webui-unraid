/** Persistent CLI selection. Only exact stable versions can become filesystem paths. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CLI_VERSION = /^\d+\.\d+\.\d+$/;
export interface CliSelection {
  version: string | null;
  previous: string | null;
}
export function cliRoot(home: string): string {
  return join(home, 'webui', 'cli');
}
export function cliBinary(home: string, version: string): string {
  if (!CLI_VERSION.test(version)) throw new Error('Invalid CLI version');
  return join(cliRoot(home), 'releases', version, 'codex');
}
export function cliSelection(home: string): CliSelection {
  const file = join(cliRoot(home), 'selection.json');
  if (!existsSync(file)) return { version: null, previous: null };
  const content = readFileSync(file, 'utf8');
  if (content.length > 1024) throw new Error('Invalid CLI selection');
  const value = JSON.parse(content) as CliSelection;
  if (
    !value ||
    ![value.version, value.previous].every(
      (version) =>
        version === null ||
        (typeof version === 'string' && CLI_VERSION.test(version)),
    )
  ) {
    throw new Error('Invalid CLI selection');
  }
  return value;
}
export function isNewerVersion(candidate: string, current: string): boolean {
  if (!CLI_VERSION.test(candidate) || !CLI_VERSION.test(current)) return false;
  const a = candidate.split('.').map(Number),
    b = current.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return false;
}
