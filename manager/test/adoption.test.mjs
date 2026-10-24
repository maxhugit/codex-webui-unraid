import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ADOPTION_CONFIRMATION,
  confirmAdoption,
  evaluateAdoption,
  readAdoptionRecord,
} from '../src/adoption.mjs';

function inventory(overrides = {}) {
  return {
    schemaVersion: 1,
    stack: 'mergeron',
    environment: 'production',
    mode: 'observe',
    observedAt: '2026-10-24T09:00:00.000Z',
    dockerConnected: true,
    components: [
      {
        id: 'application',
        containerId: 'application-full-id',
        containerName: 'mergeron-ui',
        image: 'ghcr.io/maxhugit/mergeron:edge',
        imageRepositoryAllowed: true,
        adoption: 'adoptable',
        networks: ['mergeron-admin', 'mergeron-isolated'],
        missingNetworks: [],
        protectedMounts: [
          {
            target: '/home/codex',
            source: '/mnt/pool/appdata/mergeron/state/home',
            type: 'bind',
            writable: true,
          },
          {
            target: '/workspaces',
            source: '/mnt/pool/appdata/mergeron/state/workspace',
            type: 'bind',
            writable: true,
          },
        ],
      },
      {
        id: 'ingress',
        containerId: 'ingress-full-id',
        containerName: 'mergeron-ingress',
        image: 'nginx:stable',
        imageRepositoryAllowed: true,
        adoption: 'adoptable',
        networks: ['mergeron-isolated', 'net_standard'],
        missingNetworks: [],
        protectedMounts: [],
      },
      {
        id: 'egress',
        containerId: 'egress-full-id',
        containerName: 'mergeron-squid',
        image: 'ubuntu/squid:latest',
        imageRepositoryAllowed: true,
        adoption: 'adoptable',
        networks: ['mergeron-external', 'mergeron-isolated'],
        missingNetworks: [],
        protectedMounts: [],
      },
    ],
    dataSafety: {
      status: 'protected',
      blockers: [],
      protectedMounts: [],
    },
    ...overrides,
  };
}

test('marks one complete and protected installation as eligible', () => {
  const result = evaluateAdoption(inventory());
  assert.equal(result.adoption.state, 'eligible');
  assert.equal(result.adoption.canAdopt, true);
  assert.match(result.adoption.fingerprint, /^[a-f0-9]{64}$/);
});

test('blocks adoption when a required network or protected mount is missing', () => {
  const value = inventory();
  value.components[1].missingNetworks = ['net_standard'];
  value.dataSafety.blockers = ['application:/workspaces:unprotected'];
  const result = evaluateAdoption(value);
  assert.equal(result.adoption.state, 'blocked');
  assert.deepEqual(result.adoption.blockers, [
    'application:/workspaces:unprotected',
    'ingress:net_standard:networkMissing',
  ]);
});

test('persists the exact verified inventory only after explicit confirmation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mergeron-adoption-'));
  const path = join(directory, 'adoption.json');
  try {
    const current = evaluateAdoption(inventory());
    const adopted = await confirmAdoption({
      inventory: inventory(),
      existingRecord: null,
      confirmation: ADOPTION_CONFIRMATION,
      expectedFingerprint: current.adoption.fingerprint,
      path,
      now: new Date('2026-10-24T09:05:00.000Z'),
    });
    assert.equal(adopted.adoption.state, 'adopted');
    assert.equal(adopted.adoption.adoptedAt, '2026-10-24T09:05:00.000Z');
    const record = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(record.fingerprint, current.adoption.fingerprint);
    assert.equal(
      record.components[0].protectedMounts[0].source,
      '/mnt/pool/appdata/mergeron/state/home',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses a stale preview and detects later drift without overwriting the record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mergeron-adoption-'));
  const path = join(directory, 'adoption.json');
  try {
    await assert.rejects(
      confirmAdoption({
        inventory: inventory(),
        existingRecord: null,
        confirmation: ADOPTION_CONFIRMATION,
        expectedFingerprint: 'stale',
        path,
      }),
      /adoptionInventoryChanged/,
    );
    const current = evaluateAdoption(inventory());
    await confirmAdoption({
      inventory: inventory(),
      existingRecord: null,
      confirmation: ADOPTION_CONFIRMATION,
      expectedFingerprint: current.adoption.fingerprint,
      path,
    });
    const record = await readAdoptionRecord(path);
    const changed = inventory();
    changed.components[0].image = 'ghcr.io/maxhugit/mergeron:other';
    const drifted = evaluateAdoption(changed, record);
    assert.equal(drifted.adoption.state, 'drifted');
    assert.ok(drifted.adoption.blockers.includes('adoptionRecordDrift'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
