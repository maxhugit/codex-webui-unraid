'use strict';

// Run in the qualification container, with disposable data only.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createWorker } = require('./standard-worker.cjs');

async function main() {
  const base = fs.mkdtempSync('/tmp/standard-worker-integration-');
  const storageRoot = path.join(base, 'workspaces');
  const a = path.join(storageRoot, 'a');
  const b = path.join(storageRoot, 'b');
  fs.mkdirSync(a, { recursive: true });
  fs.mkdirSync(b);
  fs.writeFileSync(path.join(b, 'private.txt'), 'TEST_OTHER_PROJECT');
  const token = crypto.randomBytes(32).toString('hex');
  const tokenFile = path.join(base, 'token');
  const registryFile = path.join(base, 'projects.json');
  fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  fs.writeFileSync(
    registryFile,
    JSON.stringify({
      version: 1,
      qualificationEnabled: true,
      projects: {
        a: { qualificationOnly: true, workspaceRoots: [a], cwd: a },
      },
    }),
  );
  let worker;
  try {
    worker = createWorker({ tokenFile, registryFile, storageRoot });
    await new Promise((resolve, reject) => {
      worker.server.once('error', reject);
      worker.server.listen(0, '127.0.0.1', resolve);
    });
    const url = `http://127.0.0.1:${worker.server.address().port}/qualification/execute`;
    const send = (body, authenticated = true) =>
      fetch(url, {
        method: 'POST',
        headers: authenticated ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify(body),
      });
    const payload = {
      projectId: 'a',
      argv: [
        '/usr/bin/python3',
        '-I',
        '-c',
        [
          'from pathlib import Path',
          'import socket',
          'assert str(Path.cwd()) == "/workspace/0"',
          `assert not Path(${JSON.stringify(path.join(b, 'private.txt'))}).exists()`,
          `assert not Path(${JSON.stringify(tokenFile)}).exists()`,
          'assert not Path("/run/secrets/standard_worker_token").exists()',
          'try:',
          ' socket.socket()',
          ' raise AssertionError("network unexpectedly allowed")',
          'except PermissionError: pass',
          'Path("receipt.txt").write_text("QUALIFICATION_ONLY")',
          'print("PASS")',
        ].join('\n'),
      ],
    };
    assert.equal((await send(payload, false)).status, 401);
    assert.equal((await send({ ...payload, workspaceRoots: [b] })).status, 400);
    assert.equal((await send({ ...payload, projectId: 'b' })).status, 400);
    const response = await send(payload);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stopped, null);
    assert.equal(result.stdout.trim(), 'PASS');
    assert.equal(
      fs.readFileSync(path.join(a, 'receipt.txt'), 'utf8'),
      'QUALIFICATION_ONLY',
    );
    assert.equal(fs.existsSync(path.join(b, 'receipt.txt')), false);
    console.log(
      JSON.stringify({
        authenticatedExecution: true,
        authorizedFileWrite: true,
        otherProjectHidden: true,
        workerSecretHidden: true,
        networkDenied: true,
        clientPathOverrideDenied: true,
        standardAgentsEnabled: false,
      }),
    );
  } finally {
    if (worker) {
      const closed = new Promise((resolve) =>
        worker.server.once('close', resolve),
      );
      worker.stop();
      await closed;
    }
    fs.rmSync(base, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
