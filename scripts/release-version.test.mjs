import assert from 'node:assert/strict';
import test from 'node:test';
import { validateReleaseVersion } from './release-version.mjs';

test('accepts synchronized development versions with major zero', () => {
  assert.deepEqual(validateReleaseVersion('0.4.2', '0.4.2', 'main'), {
    version: '0.4.2',
    channel: 'edge',
    isRelease: false,
  });
});

test('recognizes a matching stable release tag', () => {
  assert.deepEqual(validateReleaseVersion('0.4.2', '0.4.2', 'v0.4.2'), {
    version: '0.4.2',
    channel: 'stable',
    isRelease: true,
  });
});

for (const [name, root, web, ref] of [
  ['major one', '1.0.0', '1.0.0', 'v1.0.0'],
  ['prerelease', '0.4.2-beta.1', '0.4.2-beta.1', 'v0.4.2-beta.1'],
  ['different packages', '0.4.2', '0.4.1', 'main'],
  ['different tag', '0.4.2', '0.4.2', 'v0.4.3'],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(() => validateReleaseVersion(root, web, ref));
  });
}
