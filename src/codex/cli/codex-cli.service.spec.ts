/** No real downloads or processes: exercise installation, selection, admission and rollback boundaries. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { CatalogPathsService } from '../catalog/catalog-paths.service';
import { CatalogAdmissionService } from '../catalog/catalog-admission.service';
import type { CatalogActivityService } from '../catalog/catalog-activity.service';
import type { CodexProcessManager } from '../codex-process-manager.service';
import { CodexCliService } from './codex-cli.service';
import { cliSelection, isNewerVersion } from './managed-cli';

class TestCliService extends CodexCliService {
  calls: { binary: string; args: string[] }[] = [];
  failCheck = false;
  protected override async command(
    binary: string,
    args: string[],
  ): Promise<string> {
    await Promise.resolve();
    this.calls.push({ binary, args });
    if (binary === 'npm' && args[0] === 'view') {
      if (this.failCheck) throw new Error('Network unavailable');
      return '"1.1.0"';
    }
    if (binary === 'npm' && args[0] === 'install') {
      const prefix = args[args.indexOf('--prefix') + 1];
      const root = join(
        prefix,
        'node_modules',
        '@openai',
        `codex-linux-${process.arch}`,
      );
      const triple =
        process.arch === 'arm64'
          ? 'aarch64-unknown-linux-musl'
          : 'x86_64-unknown-linux-musl';
      const native = join(root, 'vendor', triple, 'bin', 'codex');
      mkdirSync(dirname(native), { recursive: true });
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: `@openai/codex-linux-${process.arch}` }),
      );
      writeFileSync(native, 'mock native binary');
      return '';
    }
    return `codex-cli ${binary.includes('/releases/') ? '1.1.0' : '1.0.0'}`;
  }
}
let directory: string;
let paths: CatalogPathsService;
let service: TestCliService;
let admission: CatalogAdmissionService;
let activity: { inspect: ReturnType<typeof vi.fn> };
let manager: {
  isStopped: ReturnType<typeof vi.fn>;
  suspendRetries: ReturnType<typeof vi.fn>;
  restartControlled: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'codex-cli-test-'));
  const config = new ConfigService({
    CODEX_HOME: directory,
    CODEX_CLI_VERSION: '1.0.0',
  });
  paths = new CatalogPathsService(config);
  admission = new CatalogAdmissionService();
  activity = {
    inspect: vi.fn().mockResolvedValue({ canApply: true, blockers: [] }),
  };
  manager = {
    isStopped: vi.fn(() => false),
    suspendRetries: vi.fn(),
    restartControlled: vi.fn((ready: () => void) => Promise.resolve(ready())),
  };
  service = new TestCliService(
    paths,
    config,
    admission,
    activity as unknown as CatalogActivityService,
    manager as unknown as CodexProcessManager,
  );
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

it('compares stable versions numerically and rejects paths or prereleases', () => {
  expect(isNewerVersion('1.10.0', '1.9.9')).toBe(true);
  expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
  expect(isNewerVersion('../../bin', '1.0.0')).toBe(false);
  expect(isNewerVersion('2.0.0-beta', '1.0.0')).toBe(false);
});
it('reports unavailable registry evidence without claiming the CLI is current', async () => {
  service.failCheck = true;
  expect(await service.status()).toMatchObject({
    installedVersion: '1.0.0',
    latestVersion: null,
    checkError: 'Unable to check npm for updates',
    updateAvailable: false,
  });
});
it('refuses active work before downloading or restarting', async () => {
  activity.inspect.mockResolvedValue({
    canApply: false,
    blockers: [{ reason: 'Running turn' }],
  });
  await expect(service.change('1.0.0', false, '1.1.0')).rejects.toThrow(
    'Codex must be idle',
  );
  expect(service.calls.some((call) => call.binary === 'npm')).toBe(false);
  expect(manager.restartControlled).not.toHaveBeenCalled();
  expect(() => admission.enter('new work')()).not.toThrow();
});
it('rejects stale installed or target versions', async () => {
  await expect(service.change('0.9.0', false, '1.1.0')).rejects.toThrow(
    'CLI version changed',
  );
  await expect(service.change('1.0.0', false, '9.9.9')).rejects.toThrow(
    'Latest CLI version changed',
  );
  expect(service.calls.some((call) => call.args[0] === 'install')).toBe(false);
});
it('installs in persistent storage, uses matching helpers and can roll back to the image', async () => {
  await service.change('1.0.0', false, '1.1.0');
  expect(cliSelection(directory)).toEqual({ version: '1.1.0', previous: null });
  expect(existsSync(paths.binary)).toBe(true);
  expect(paths.childPath).toContain('/releases/1.1.0/helpers');
  expect(
    readlinkSync(join(dirname(paths.binary), 'helpers', 'apply_patch')),
  ).toBe('../codex');
  expect(
    service.calls.find((call) => call.args[0] === 'install')?.args,
  ).toContain('--ignore-scripts');
  await service.change('1.1.0', true);
  expect(cliSelection(directory).version).toBeNull();
  expect(manager.restartControlled).toHaveBeenCalledTimes(2);
});
it('restores the previous selection and restarts it after activation failure', async () => {
  manager.restartControlled.mockRejectedValueOnce(
    new Error('Initialize failed'),
  );
  await expect(service.change('1.0.0', false, '1.1.0')).rejects.toThrow(
    'Initialize failed',
  );
  expect(cliSelection(directory).version).toBeNull();
  expect(manager.restartControlled).toHaveBeenCalledTimes(2);
  expect(() => admission.enter('new work')()).not.toThrow();
});
it('rechecks idle after download and never switches a now-busy server', async () => {
  activity.inspect
    .mockResolvedValueOnce({ canApply: true, blockers: [] })
    .mockResolvedValueOnce({ canApply: false, blockers: [] });
  await expect(service.change('1.0.0', false, '1.1.0')).rejects.toThrow(
    'Codex must be idle',
  );
  expect(cliSelection(directory).version).toBeNull();
  expect(manager.restartControlled).not.toHaveBeenCalled();
});

it('allows recovery of a selected CLI when the managed app-server is fully stopped', async () => {
  await service.change('1.0.0', false, '1.1.0');
  manager.isStopped.mockReturnValue(true);
  activity.inspect.mockResolvedValue({ canApply: false, blockers: [] });
  await service.change('1.1.0', true);
  expect(cliSelection(directory).version).toBeNull();
});
