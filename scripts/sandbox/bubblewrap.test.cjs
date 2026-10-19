'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  validatePolicy,
  seccompFilter,
  runSandbox,
} = require('./bubblewrap.cjs');

function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync('/tmp/codex-bwrap-unit-'));
  const a = path.join(base, 'a');
  const b = path.join(base, 'b');
  fs.mkdirSync(a);
  fs.mkdirSync(b);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return {
    base,
    a,
    b,
    policy: {
      workspaceRoots: [a],
      cwd: a,
      mcp: 'disabled',
      network: 'disabled',
    },
  };
}
test('requires explicit offline/MCP-disabled policy', (t) => {
  const { policy } = fixture(t);
  assert.throws(() => validatePolicy({ ...policy, mcp: 'enabled' }));
  assert.throws(() => validatePolicy({ ...policy, network: 'enabled' }));
  assert.throws(() => validatePolicy({ ...policy, mcp: undefined }));
});
test('rejects absent, relative, broad and protected roots', (t) => {
  const { policy, base } = fixture(t);
  for (const root of [
    '/',
    '/tmp',
    '/etc',
    '/home',
    '/usr',
    'relative',
    path.join(base, 'absent'),
  ])
    assert.throws(() => validatePolicy({ ...policy, workspaceRoots: [root] }));
  assert.throws(() => validatePolicy({ ...policy, workspaceRoots: [] }));
});
test('does not authorize a sibling or an escaping cwd symlink', (t) => {
  const { policy, a, b } = fixture(t);
  assert.throws(() => validatePolicy({ ...policy, cwd: b }));
  const alias = path.join(a, 'escape');
  fs.symlinkSync(b, alias);
  assert.throws(() => validatePolicy({ ...policy, cwd: alias }));
});
test('canonicalizes trusted roots but rejects aliases into protected runtime paths', (t) => {
  const { policy, base } = fixture(t);
  const alias = path.join(base, 'protected');
  fs.symlinkSync('/etc', alias);
  assert.throws(() =>
    validatePolicy({ ...policy, workspaceRoots: [alias], cwd: alias }),
  );
});
test('rejects overlapping roots and maps multiple disjoint roots to fixed names', (t) => {
  const { policy, a, b } = fixture(t);
  const child = path.join(a, 'child');
  fs.mkdirSync(child);
  assert.throws(() =>
    validatePolicy({ ...policy, workspaceRoots: [a, child] }),
  );
  assert.throws(() => validatePolicy({ ...policy, workspaceRoots: [a, a] }));
  assert.equal(
    validatePolicy({ ...policy, workspaceRoots: [a, b], cwd: b }).sandboxCwd,
    '/workspace/1',
  );
  assert.equal(
    validatePolicy({ ...policy, cwd: child }).sandboxCwd,
    '/workspace/0/child',
  );
});
function evaluate(filter, arch, nr) {
  let accumulator = 0;
  for (let pc = 0; pc < filter.length / 8; pc++) {
    const offset = pc * 8,
      op = filter.readUInt16LE(offset),
      jt = filter[offset + 2],
      jf = filter[offset + 3],
      k = filter.readUInt32LE(offset + 4);
    if (op === 0x20) accumulator = k === 4 ? arch : nr;
    else if (op === 0x15) pc += accumulator === k ? jt : jf;
    else if (op === 0x45) pc += (accumulator & k) !== 0 ? jt : jf;
    else if (op === 0x06) return k;
    else throw new Error('Unsupported filter instruction');
  }
  throw new Error('Missing filter return');
}
test('seccomp denies socket, escape and io_uring calls while allowing file IO', () => {
  const filter = seccompFilter('x64');
  for (const nr of [
    41, 42, 53, 101, 165, 272, 308, 310, 321, 425, 426, 427, 438,
  ])
    assert.equal(evaluate(filter, 0xc000003e, nr), 0x50001, String(nr));
  assert.equal(evaluate(filter, 0xc000003e, 0), 0x7fff0000);
  assert.equal(evaluate(filter, 0xc000003e, 1), 0x7fff0000);
  assert.equal(evaluate(filter, 0xc000003e, 435), 0x50026);
});
test('seccomp fails closed for x32, compat and unknown architectures', () => {
  const filter = seccompFilter('x64');
  assert.equal(evaluate(filter, 0xc000003e, 0x40000029), 0x50001);
  assert.equal(evaluate(filter, 0x40000003, 102), 0x80000000);
  assert.equal(evaluate(filter, 0xc00000b7, 198), 0x80000000);
  assert.throws(() => seccompFilter('arm64'));
});
test('invalid timeout is rejected before executing any payload', async () => {
  await assert.rejects(runSandbox({}, ['/bin/true'], { timeoutMs: 0 }));
  await assert.rejects(runSandbox({}, ['/bin/true'], { timeoutMs: 31000 }));
});
