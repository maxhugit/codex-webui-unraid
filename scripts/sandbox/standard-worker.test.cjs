'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  createWorker,
  authorize,
  selectProject,
} = require('./standard-worker.cjs');

async function fixture(t, execute) {
  const base = fs.realpathSync(fs.mkdtempSync('/tmp/codex-worker-test-'));
  const storageRoot = path.join(base, 'storage');
  const workspace = path.join(storageRoot, 'project-a');
  fs.mkdirSync(workspace, { recursive: true });
  const tokenFile = path.join(base, 'token');
  const registryFile = path.join(base, 'projects.json');
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(tokenFile, token, { mode: 0o600 });
  const registry = {
    version: 1,
    qualificationEnabled: true,
    projects: {
      a: {
        qualificationOnly: true,
        workspaceRoots: [workspace],
        cwd: workspace,
      },
    },
  };
  fs.writeFileSync(registryFile, JSON.stringify(registry));
  const calls = [];
  const worker = createWorker({
    tokenFile,
    registryFile,
    storageRoot,
    execute:
      execute ??
      (async (...args) => {
        calls.push(args);
        return { code: 0 };
      }),
  });
  await new Promise((resolve, reject) => {
    worker.server.once('error', reject);
    worker.server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    const closed = new Promise((resolve) =>
      worker.server.once('close', resolve),
    );
    worker.stop();
    await closed;
    fs.rmSync(base, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${worker.server.address().port}`;
  const request = (
    payload = { projectId: 'a', argv: ['/bin/true'] },
    route = '/qualification/execute',
    headers = {},
  ) =>
    fetch(url + route, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(payload),
    });
  return {
    base,
    storageRoot,
    workspace,
    tokenFile,
    registryFile,
    token,
    registry,
    worker,
    calls,
    url,
    request,
  };
}

test('token comparison rejects absent and malformed credentials', () => {
  assert.equal(authorize(undefined, 'a'.repeat(64)), false);
  assert.equal(authorize('Bearer a', 'a'.repeat(64)), false);
  assert.equal(authorize(`Bearer ${'a'.repeat(64)}`, 'a'.repeat(64)), true);
});
test('authentication applies even to health and prevents execution', async (t) => {
  const f = await fixture(t);
  assert.equal((await fetch(f.url + '/health')).status, 401);
  assert.equal(
    (await f.request(undefined, undefined, { Authorization: 'Bearer wrong' }))
      .status,
    401,
  );
  assert.equal(f.calls.length, 0);
});
test('public execution stays closed even when qualification is enabled', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request(undefined, '/execute')).status, 503);
  assert.equal(f.calls.length, 0);
  const health = await fetch(f.url + '/health', {
    headers: { Authorization: `Bearer ${f.token}` },
  });
  assert.equal((await health.json()).standardAgentsEnabled, false);
});
test('only server-owned registry determines cwd, workspaces and policy', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request()).status, 200);
  assert.deepEqual(f.calls[0][0], {
    workspaceRoots: [f.workspace],
    cwd: f.workspace,
    mcp: 'disabled',
    network: 'disabled',
  });
  for (const key of [
    'cwd',
    'workspaceRoots',
    'mcp',
    'network',
    'timeoutMs',
    'role',
  ]) {
    assert.equal(
      (
        await f.request({
          projectId: 'a',
          argv: ['/bin/true'],
          [key]: 'override',
        })
      ).status,
      400,
    );
  }
  assert.equal(f.calls.length, 1);
});
test('unknown projects and prototype names cannot be executed', async (t) => {
  const f = await fixture(t);
  for (const projectId of ['b', '../a', '__proto__', 'constructor'])
    assert.equal(
      (await f.request({ projectId, argv: ['/bin/true'] })).status,
      400,
    );
  assert.equal(f.calls.length, 0);
});
test('storage boundaries reject root, sibling and symlink outside storage', async (t) => {
  const f = await fixture(t);
  const alias = path.join(f.storageRoot, 'escape');
  fs.symlinkSync(f.base, alias);
  for (const root of [f.storageRoot, f.base, alias]) {
    f.registry.projects.a.workspaceRoots = [root];
    f.registry.projects.a.cwd = root;
    assert.throws(() => selectProject(f.registry, 'a', f.storageRoot));
  }
});
test('gate and token changes are read for every new request', async (t) => {
  const f = await fixture(t);
  f.registry.qualificationEnabled = false;
  fs.writeFileSync(f.registryFile, JSON.stringify(f.registry));
  assert.equal((await f.request()).status, 400);
  fs.writeFileSync(f.tokenFile, crypto.randomBytes(32).toString('hex'));
  assert.equal((await f.request()).status, 401);
  assert.equal(f.calls.length, 0);
});
test('sandbox failure does not fall back and does not disclose diagnostics', async (t) => {
  let count = 0;
  const f = await fixture(t, async () => {
    count++;
    throw new Error('SECRET /private/path');
  });
  const res = await f.request();
  assert.equal(res.status, 503);
  assert.doesNotMatch(await res.text(), /SECRET|private/);
  assert.equal(count, 1);
});
test('concurrent execution is refused and emergency shutdown aborts active work', async (t) => {
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  let signal;
  const f = await fixture(t, async (_policy, _argv, options) => {
    signal = options.signal;
    started();
    await new Promise((resolve) =>
      signal.addEventListener('abort', resolve, { once: true }),
    );
    return { code: null, stopped: 'cancelled' };
  });
  const abort = new AbortController();
  const pending = fetch(f.url + '/qualification/execute', {
    method: 'POST',
    signal: abort.signal,
    headers: { Authorization: `Bearer ${f.token}` },
    body: JSON.stringify({ projectId: 'a', argv: ['/bin/true'] }),
  }).catch(() => null);
  await ready;
  assert.equal((await f.request()).status, 503);
  abort.abort();
  await pending;
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(signal.aborted, true);
});
