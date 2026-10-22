/** Exercise the built archive adapters against real files and the managed CLI. */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  copyFile,
  rm,
} = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createRequire } = require('node:module');
const { gzipSync } = require('node:zlib');
const appRequire = createRequire(join(process.cwd(), 'package.json'));
const tar = appRequire('tar-stream');
const { SevenZipArchiveAdapter } = appRequire(
  './dist/archive/adapters/sevenzip-archive.adapter.js',
);
const { TarArchiveAdapter } = appRequire(
  './dist/archive/adapters/tar-archive.adapter.js',
);
const { ZipArchiveAdapter } = appRequire(
  './dist/archive/adapters/zip-archive.adapter.js',
);

async function contents(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function main() {
  const version = execFileSync('7za', ['i'], {
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.match(version, /7-Zip \(z\) 26\.05/);
  const root = await mkdtemp(join(tmpdir(), 'webui-archives-'));
  const source = join(root, 'source');
  const archives = join(root, 'archives');
  try {
    await mkdir(join(source, 'folder'), { recursive: true });
    await mkdir(archives);
    const files = new Map([
      ['folder/hello.txt', Buffer.from('archive content')],
      ['folder/été.txt', Buffer.from('accented filename')],
      ['literal*.txt', Buffer.from('literal wildcard')],
      ['literalx.txt', Buffer.from('must not be concatenated')],
      ['empty.txt', Buffer.alloc(0)],
      ['binary.bin', Buffer.from([0, 255, 1, 128, 0])],
    ]);
    for (const [name, data] of files) await writeFile(join(source, name), data);
    const cli = (args) =>
      execFileSync('7za', args, {
        cwd: source,
        timeout: 30000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    const seven = new SevenZipArchiveAdapter();
    const sevenPath = join(archives, 'files.7z');
    cli(['a', '-t7z', '-spd', '--', sevenPath, ...files.keys()]);
    const zipPath = join(archives, 'files.zip');
    cli(['a', '-tzip', '-spd', '--', zipPath, ...files.keys()]);

    const pack = tar.pack();
    for (const [name, data] of files) pack.entry({ name, type: 'file' }, data);
    pack.entry({ name: 'link', type: 'symlink', linkname: '/etc/passwd' });
    pack.finalize();
    const tarBytes = await contents(pack);
    const tarPath = join(archives, 'files.tar');
    await writeFile(tarPath, tarBytes);
    await writeFile(join(archives, 'files.tar.gz'), gzipSync(tarBytes));
    for (const [extension, format] of [
      ['xz', 'xz'],
      ['bz2', 'bzip2'],
    ]) {
      cli(['a', `-t${format}`, '--', `${tarPath}.${extension}`, tarPath]);
    }
    for (const [from, to] of [
      ['tar.gz', 'tgz'],
      ['tar.xz', 'txz'],
      ['tar.bz2', 'tbz2'],
    ]) {
      await copyFile(
        join(archives, `files.${from}`),
        join(archives, `files.${to}`),
      );
    }
    const before = (await readdir(archives)).sort();
    const tarAdapter = new TarArchiveAdapter();
    for (const [extension, adapter] of [
      ['7z', seven],
      ['zip', new ZipArchiveAdapter()],
      ...['tar', 'tar.gz', 'tgz', 'tar.xz', 'txz', 'tar.bz2', 'tbz2'].map(
        (ext) => [ext, tarAdapter],
      ),
    ]) {
      const path = join(archives, `files.${extension}`);
      assert.ok(adapter.supports(path));
      const entries = await adapter.list(path);
      for (const [name, data] of files) {
        const entry = entries.find((entry) => entry.path === name);
        assert.ok(entry, `${extension}: missing ${name}`);
        assert.equal(entry.size, data.length);
        assert.deepEqual(
          await contents(await adapter.openEntryStream(path, name)),
          data,
        );
      }
      if (adapter === tarAdapter)
        assert.equal(
          entries.find((entry) => entry.path === 'link').unsupported,
          true,
        );
      console.log(`Archive listing and streaming passed: ${extension}`);
    }
    assert.deepEqual(
      (await readdir(archives)).sort(),
      before,
      'Reading must not extract files to disk',
    );

    const encrypted = join(archives, 'encrypted.7z');
    cli(['a', '-t7z', '-psecret', '--', encrypted, 'folder/hello.txt']);
    assert.equal((await seven.list(encrypted))[0].encrypted, true);
    await assert.rejects(async () =>
      contents(await seven.openEntryStream(encrypted, 'folder/hello.txt')),
    );

    const disguised = join(archives, 'disguised.7z');
    await copyFile(zipPath, disguised);
    await assert.rejects(seven.list(disguised));
    await assert.rejects(async () =>
      contents(await seven.openEntryStream(disguised, 'empty.txt')),
    );
    const falseXz = join(archives, 'disguised.tar.xz');
    await copyFile(sevenPath, falseXz);
    await assert.rejects(tarAdapter.list(falseXz));

    const damaged = join(archives, 'damaged.7z');
    await writeFile(damaged, (await readFile(sevenPath)).subarray(0, 32));
    await assert.rejects(seven.list(damaged));
    console.log('Encrypted, corrupted and disguised archive checks passed.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
