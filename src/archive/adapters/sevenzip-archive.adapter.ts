/** 7z adapter: the managed 7za binary lists and streams archive entries. */
import { Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { PassThrough, type Readable } from 'node:stream';
import { promisify } from 'node:util';
import { archiveEntryName, normalizeArchiveEntryPath } from '../archive-path';
import type { ArchiveAdapter, ArchiveEntry } from '../archive.types';

const execFileAsync = promisify(execFile);

@Injectable()
export class SevenZipArchiveAdapter implements ArchiveAdapter {
  readonly label = '7z';
  private sevenZaChecked = false;
  private sevenZaAvailable = false;

  /** Returns true for 7z archives. */
  supports(archivePath: string): boolean {
    return archivePath.toLowerCase().endsWith('.7z');
  }

  /** Lists only 7z format; never falls back to another signature-based handler. */
  async list(archivePath: string): Promise<ArchiveEntry[]> {
    this.assert7zaAvailable();
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(
        '7za',
        ['l', '-slt', '-ba', '-t7z', '-sccUTF-8', '-p-', '--', archivePath],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30_000 },
      ));
    } catch {
      throw BusinessException.badRequest(
        ErrorCode.archive.unsupportedFormat,
        'Unable to list 7z archive',
      );
    }
    return stdout
      .trim()
      .split(/\r?\n\r?\n/)
      .map((block) => this.toEntry(block))
      .filter((entry): entry is ArchiveEntry => entry !== null);
  }

  /** Streams one 7z entry via host `7za x -so`, never extracting to disk. */
  // eslint-disable-next-line @typescript-eslint/require-await
  async openEntryStream(
    archivePath: string,
    entryPath: string,
  ): Promise<Readable> {
    this.assert7zaAvailable();
    const output = new PassThrough();
    // -spd disables wildcard matching so entry names with * or ? are treated literally
    const child = spawn(
      '7za',
      ['x', '-so', '-y', '-spd', '-t7z', '-p-', '--', archivePath, entryPath],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let childDone = false;
    const killChild = () => {
      if (!childDone && !child.killed) child.kill();
    };
    child.stderr.resume();
    child.stdout.once('end', () => {
      childDone = true;
    });
    output.once('close', killChild);
    child.stdout.pipe(output, { end: false });
    child.on('error', (error) => output.destroy(error));
    child.on('close', (code) => {
      childDone = true;
      output.off('close', killChild);
      if (code !== 0) {
        output.destroy(
          BusinessException.badRequest(
            ErrorCode.archive.entryUnsupported,
            'Unable to stream archive entry',
          ),
        );
      } else {
        output.end();
      }
    });
    return output;
  }

  /** Converts technical listing records to the shared archive entry shape. */
  private toEntry(block: string): ArchiveEntry | null {
    const fields: Record<string, string> = {};
    for (const line of block.split(/\r?\n/)) {
      const separator = line.indexOf(' = ');
      if (separator < 0) continue;
      const key = line.slice(0, separator);
      if (Object.hasOwn(fields, key)) {
        throw BusinessException.badRequest(
          ErrorCode.archive.unsafeEntryPath,
          'Ambiguous 7z entry metadata',
        );
      }
      fields[key] = line.slice(separator + 3);
    }
    const normalized = normalizeArchiveEntryPath(fields.Path ?? '');
    if (!normalized) return null;
    const isDirectory =
      fields.Folder === '+' || (fields.Attributes ?? '').includes('D');
    const size = Number(fields.Size ?? 0);
    return {
      name: archiveEntryName(normalized),
      path: normalized,
      type: isDirectory ? 'directory' : 'file',
      size: isDirectory || !Number.isFinite(size) ? undefined : size,
      encrypted: fields.Encrypted === '+',
    };
  }

  /** Fails fast with a clear message when host 7za is not installed (cached after first check). */
  private assert7zaAvailable(): void {
    if (this.sevenZaChecked) {
      if (!this.sevenZaAvailable) {
        throw BusinessException.badRequest(
          ErrorCode.archive.sevenZipUnavailable,
          '7za binary is not available on the host',
        );
      }
      return;
    }
    const result = spawnSync('7za', ['i'], { stdio: 'ignore' });
    this.sevenZaChecked = true;
    this.sevenZaAvailable = !result.error && result.status === 0;
    if (!this.sevenZaAvailable) {
      throw BusinessException.badRequest(
        ErrorCode.archive.sevenZipUnavailable,
        '7za binary is not available on the host',
      );
    }
  }
}
