import http from 'node:http';
import { chmod, chown, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DockerClient } from './docker-client.mjs';
import {
  collectInventory,
  scopeManifest,
  unavailableInventory,
} from './inventory.mjs';

const manifestPath = fileURLToPath(
  new URL('../stack-manifest.json', import.meta.url),
);
const manifest = scopeManifest(
  JSON.parse(await readFile(manifestPath, 'utf8')),
  process.env.MERGERON_STACK_PREFIX,
);
const socketPath =
  process.env.MERGERON_MANAGER_SOCKET ?? '/run/mergeron-manager/manager.sock';
const socketGroup = Number(process.env.MERGERON_MANAGER_SOCKET_GID ?? 11002);
const pollInterval = Math.max(
  5_000,
  Number(process.env.MERGERON_MANAGER_POLL_MS ?? 20_000),
);
const docker = new DockerClient(
  process.env.MERGERON_DOCKER_SOCKET ?? '/var/run/docker.sock',
);

let snapshot = unavailableInventory(
  manifest,
  new Error('Inventory not collected yet'),
);
let refreshing = null;
const events = [];

function signature(value) {
  return JSON.stringify(
    value.components.map((component) => ({
      id: component.id,
      state: component.state,
      adoption: component.adoption,
      networks: component.networks,
      mounts: component.protectedMounts.map((mount) => ({
        target: mount.target,
        present: mount.present,
        writable: mount.writable,
      })),
    })),
  );
}

async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const previous = snapshot;
    try {
      snapshot = await collectInventory(manifest, docker);
    } catch (error) {
      snapshot = unavailableInventory(manifest, error);
    }
    if (signature(previous) !== signature(snapshot)) {
      events.push({ at: snapshot.observedAt, type: 'inventoryChanged' });
      if (events.length > 100) events.splice(0, events.length - 100);
    }
    return snapshot;
  })();
  try {
    return await refreshing;
  } finally {
    refreshing = null;
  }
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  if (request.method !== 'GET') {
    json(response, 405, { error: 'readOnlyManager' });
    return;
  }
  if (request.url === '/healthz') {
    json(response, 200, { status: 'ok', mode: 'observe' });
    return;
  }
  if (request.url === '/v1/status') {
    await refresh();
    json(response, 200, { ...snapshot, events: [...events] });
    return;
  }
  json(response, 404, { error: 'notFound' });
});

await mkdir(dirname(socketPath), { recursive: true, mode: 0o750 });
await rm(socketPath, { force: true });
server.listen(socketPath, async () => {
  await chmod(socketPath, 0o660);
  if (Number.isInteger(socketGroup) && socketGroup >= 0) {
    await chown(socketPath, 0, socketGroup).catch(() => undefined);
  }
  await refresh();
  setInterval(() => void refresh(), pollInterval).unref();
  console.log(`Mergeron Manager observe-only socket ready at ${socketPath}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
