/** Resolves catalog and user-config locations even when Codex cannot initialize. */
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { cliBinary, cliSelection } from '../cli/managed-cli';

@Injectable()
export class CatalogPathsService {
  constructor(private readonly config: ConfigService) {}

  /** Absolute Codex home passed to both the app-server and validation subprocesses. */
  get home(): string {
    return resolve(
      this.config.get<string>('CODEX_HOME') || join(homedir(), '.codex'),
    );
  }
  /** User-level config path, independent of config/read. */
  get configFile(): string {
    return join(this.home, 'config.toml');
  }
  /** Application-owned writable catalog directory, persisted by the Codex-home volume. */
  get directory(): string {
    return join(this.home, 'webui', 'model-catalog');
  }
  /** Prefer the project's pinned installation unless CODEX_BIN explicitly overrides it. */
  get binary(): string {
    const override = this.config.get<string>('CODEX_BIN');
    if (override) return override.includes('/') ? resolve(override) : override;
    const selected = cliSelection(this.home).version;
    if (selected) return cliBinary(this.home, selected);
    const local = resolve('node_modules/.bin/codex');
    return existsSync(local) ? local : 'codex';
  }
  /** Version-matched argv[0] tools for commands dispatched by the managed child. */
  get childPath(): string | undefined {
    if (this.config.get<string>('CODEX_BIN')) return process.env.PATH;
    const selected = cliSelection(this.home).version;
    return selected
      ? `${join(cliBinary(this.home, selected), '..', 'helpers')}:${process.env.PATH ?? ''}`
      : process.env.PATH;
  }
}
