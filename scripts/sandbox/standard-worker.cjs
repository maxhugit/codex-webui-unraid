'use strict';

// Qualification service only. No public agent route, credentials, or Codex fallback.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { runSandbox, validatePolicy } = require('./bubblewrap.cjs');

function readToken(file) {
  const token = fs.readFileSync(file, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid worker token');
  return token;
}

function authorize(header, token) {
  const expected = Buffer.from(`Bearer ${token}`);
  const supplied = Buffer.from(typeof header === 'string' ? header : '');
  return (
    expected.length === supplied.length &&
    crypto.timingSafeEqual(expected, supplied)
  );
}

function selectProject(registry, id, storageRoot) {
  if (registry?.version !== 1 || registry.qualificationEnabled !== true)
    throw new Error('Qualification is disabled');
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id))
    throw new Error('Invalid project');
  const project = Object.hasOwn(registry.projects ?? {}, id)
    ? registry.projects[id]
    : undefined;
  if (!project || project.qualificationOnly !== true)
    throw new Error('Project is not authorized');
  const policy = {
    workspaceRoots: project.workspaceRoots,
    cwd: project.cwd,
    mcp: 'disabled',
    network: 'disabled',
  };
  const validated = validatePolicy(policy);
  const storage = fs.realpathSync(storageRoot);
  for (const root of validated.roots) {
    const relative = path.relative(storage, root);
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new Error('Workspace is outside dedicated storage');
  }
  return policy;
}

function createWorker({
  tokenFile,
  registryFile,
  storageRoot,
  execute = runSandbox,
}) {
  readToken(tokenFile); // Never start with an empty/default credential.
  const active = new Set();
  let closing = false;
  const send = (res, status, data) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer(
    { maxHeaderSize: 8192 },
    async (req, res) => {
      try {
        if (!authorize(req.headers.authorization, readToken(tokenFile))) {
          req.resume();
          return send(res, 401, { error: 'Unauthorized' });
        }
        if (req.method === 'GET' && req.url === '/health')
          return send(res, 200, {
            status: 'ok',
            mode: 'qualification',
            standardAgentsEnabled: false,
            active: active.size,
          });
        // Deliberately cannot activate standard users through an environment variable.
        if (req.url === '/execute') {
          req.resume();
          return send(res, 503, {
            error: 'Standard agents are not validated or enabled',
          });
        }
        if (req.method !== 'POST' || req.url !== '/qualification/execute') {
          req.resume();
          return send(res, 404, { error: 'Not found' });
        }
        if (closing || active.size >= 1) {
          req.resume();
          return send(res, 503, { error: 'Worker unavailable' });
        }
        const controller = new AbortController();
        active.add(controller); // Reserve before reading the body, not after validation.
        const abort = () => {
          if (!res.writableEnded) controller.abort();
        };
        res.once('close', abort);
        try {
          let size = 0;
          const chunks = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 16384) {
              send(res, 413, { error: 'Request too large' });
              req.destroy();
              return;
            }
            chunks.push(chunk);
          }
          let payload, policy;
          try {
            payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (
              !payload ||
              Object.keys(payload).some(
                (key) => !['projectId', 'argv'].includes(key),
              )
            )
              throw new Error('Unexpected fields');
            if (
              !Array.isArray(payload.argv) ||
              !payload.argv.length ||
              payload.argv.length > 64 ||
              payload.argv.some(
                (v) => typeof v !== 'string' || v.includes('\0'),
              ) ||
              !path.isAbsolute(payload.argv[0])
            )
              throw new Error('Invalid command');
            policy = selectProject(
              JSON.parse(fs.readFileSync(registryFile, 'utf8')),
              payload.projectId,
              storageRoot,
            );
          } catch {
            return send(res, 400, {
              error: 'Invalid or unauthorized qualification request',
            });
          }
          const result = await execute(policy, payload.argv, {
            timeoutMs: 10000,
            signal: controller.signal,
          });
          if (!res.destroyed) send(res, 200, result);
        } finally {
          res.off('close', abort);
          active.delete(controller);
        }
      } catch {
        // No filesystem paths, tokens, command text or inherited environment in errors/logs.
        if (!res.headersSent && !res.destroyed)
          send(res, 503, { error: 'Worker unavailable; no fallback' });
      }
    },
  );
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  return {
    server,
    stop() {
      closing = true;
      for (const controller of active) controller.abort();
      server.close();
      server.closeAllConnections();
    },
  };
}

if (require.main === module) {
  try {
    if (
      process.platform !== 'linux' ||
      process.arch !== 'x64' ||
      process.getuid() === 0
    )
      throw new Error('Requires non-root Linux x86_64');
    const worker = createWorker({
      tokenFile: '/run/secrets/standard_worker_token',
      registryFile: '/etc/standard-worker/projects.json',
      storageRoot: '/workspaces',
    });
    worker.server.listen(8173, '0.0.0.0');
    for (const signal of ['SIGTERM', 'SIGINT'])
      process.once(signal, () => worker.stop());
  } catch {
    console.error('Standard worker refused startup');
    process.exitCode = 1;
  }
}

module.exports = { authorize, selectProject, createWorker };
