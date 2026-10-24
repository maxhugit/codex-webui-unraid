import http from 'node:http';
import { chmod, chown, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DockerClient } from './docker-client.mjs';
import {
  confirmAdoption,
  evaluateAdoption,
  readAdoptionRecord,
} from './adoption.mjs';
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
const adoptionPath =
  process.env.MERGERON_MANAGER_ADOPTION_PATH ??
  '/var/lib/mergeron-manager/adoption.json';
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
let adopting = null;
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
      const inventory = await collectInventory(manifest, docker);
      snapshot = evaluateAdoption(
        inventory,
        await readAdoptionRecord(adoptionPath),
      );
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

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 16 * 1024)
        request.destroy(new Error('requestBodyTooLarge'));
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('invalidJsonBody'));
      }
    });
    request.on('error', reject);
  });
}

async function adopt(body) {
  if (adopting) return adopting;
  adopting = (async () => {
    const inventory = await collectInventory(manifest, docker);
    const result = await confirmAdoption({
      inventory,
      existingRecord: await readAdoptionRecord(adoptionPath),
      confirmation: body?.confirmation,
      expectedFingerprint: body?.expectedFingerprint,
      path: adoptionPath,
    });
    snapshot = result;
    events.push({ at: result.observedAt, type: 'installationAdopted' });
    if (events.length > 100) events.splice(0, events.length - 100);
    return result;
  })();
  try {
    return await adopting;
  } finally {
    adopting = null;
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
  if (request.url === '/healthz') {
    if (request.method !== 'GET') {
      json(response, 405, { error: 'methodNotAllowed' });
      return;
    }
    json(response, 200, { status: 'ok', mode: 'observe' });
    return;
  }
  if (request.url === '/v1/status') {
    if (request.method !== 'GET') {
      json(response, 405, { error: 'methodNotAllowed' });
      return;
    }
    await refresh();
    json(response, 200, { ...snapshot, events: [...events] });
    return;
  }
  if (request.url === '/v1/adoption' && request.method === 'POST') {
    try {
      const result = await adopt(await readJsonBody(request));
      json(response, 200, { ...result, events: [...events] });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'adoptionFailed';
      const status =
        code === 'adoptionConfirmationRequired' || code === 'invalidJsonBody'
          ? 400
          : 409;
      json(response, status, { error: code });
    }
    return;
  }
  if (request.method !== 'GET') {
    json(response, 405, { error: 'methodNotAllowed' });
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
