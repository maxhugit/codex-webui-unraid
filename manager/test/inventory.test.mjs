import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { collectInventory } from '../src/inventory.mjs';

const manifest = JSON.parse(
  await readFile(new URL('../stack-manifest.json', import.meta.url), 'utf8'),
);

function fixtureDocker({ missingWorkspace = false, duplicate = false } = {}) {
  const containers = [
    {
      Id: 'application-id-123456789',
      Names: ['/codex-webui'],
      Image: 'ghcr.io/maxhugit/mergeron:latest',
      Labels: {},
    },
    {
      Id: 'ingress-id-123456789',
      Names: ['/mergeron-ingress'],
      Image: 'nginx:stable',
      Labels: {
        'io.mergeron.managed': 'true',
        'io.mergeron.component': 'ingress',
      },
    },
    {
      Id: 'egress-id-123456789',
      Names: ['/mergeron-squid'],
      Image: 'ubuntu/squid:latest',
      Labels: {},
    },
  ];
  if (duplicate)
    containers.push({
      Id: 'application-duplicate',
      Names: ['/mergeron-ui'],
      Image: 'ghcr.io/maxhugit/mergeron:latest',
      Labels: {},
    });
  const inspections = Object.fromEntries(
    containers.map((container) => [
      container.Id,
      {
        Name: container.Names[0],
        Config: { Image: container.Image, Labels: container.Labels },
        State: {
          Running: true,
          Status: 'running',
          Health: { Status: 'healthy' },
        },
        RestartCount: 0,
        NetworkSettings: {
          Networks: container.Id.startsWith('application')
            ? { 'mergeron-isolated': {}, 'mergeron-admin': {} }
            : container.Id.startsWith('ingress')
              ? { 'mergeron-isolated': {}, net_standard: {} }
              : { 'mergeron-isolated': {}, 'mergeron-external': {} },
        },
        Mounts: container.Id.startsWith('application')
          ? [
              {
                Source: '/mnt/pool/appdata/mergeron/state/home',
                Destination: '/home/codex',
                Type: 'bind',
                RW: true,
              },
              ...(!missingWorkspace
                ? [
                    {
                      Source: '/mnt/pool/appdata/mergeron/state/workspace',
                      Destination: '/workspaces',
                      Type: 'bind',
                      RW: true,
                    },
                  ]
                : []),
            ]
          : [],
      },
    ]),
  );
  return {
    listContainers: async () => containers,
    inspectContainer: async (id) => inspections[id],
  };
}

test('adopts legacy names without mutating them and protects existing data mounts', async () => {
  const status = await collectInventory(
    manifest,
    fixtureDocker(),
    new Date('2026-10-24T07:00:00Z'),
  );
  assert.equal(status.mode, 'observe');
  assert.equal(status.dataSafety.status, 'protected');
  assert.deepEqual(
    status.components.map(({ id, adoption, state }) => ({
      id,
      adoption,
      state,
    })),
    [
      { id: 'application', adoption: 'adoptable', state: 'healthy' },
      { id: 'ingress', adoption: 'managed', state: 'healthy' },
      { id: 'egress', adoption: 'adoptable', state: 'healthy' },
    ],
  );
});

test('blocks future management if a persistent workspace mount is missing', async () => {
  const status = await collectInventory(
    manifest,
    fixtureDocker({ missingWorkspace: true }),
  );
  assert.equal(status.dataSafety.status, 'blocked');
  assert.deepEqual(status.dataSafety.blockers, [
    'application:/workspaces:unprotected',
  ]);
});

test('refuses to choose between duplicate application containers', async () => {
  const status = await collectInventory(
    manifest,
    fixtureDocker({ duplicate: true }),
  );
  assert.equal(status.components[0].state, 'conflict');
  assert.equal(status.dataSafety.status, 'blocked');
  assert.ok(
    status.dataSafety.blockers.includes('application:multipleContainers'),
  );
});
