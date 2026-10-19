'use strict';

/** Qualification only: pinned Codex + synthetic Responses server, no account or API key. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

async function main() {
  const directory = fs.mkdtempSync('/tmp/codex-noenv-probe-');
  const frames = [];
  let child;
  const provider = http.createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      let bytes = Buffer.concat(chunks);
      if (request.headers['content-encoding'] === 'zstd') bytes = zlib.zstdDecompressSync(bytes);
      if (request.headers['content-encoding'] === 'gzip') bytes = zlib.gunzipSync(bytes);
      const body = JSON.parse(bytes.toString());
      frames.push({ url: request.url, body });
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const item = { type: 'message', id: 'msg_probe', role: 'assistant', content: [{ type: 'output_text', text: 'PROBE_OK', annotations: [] }] };
      const events = [
        { type: 'response.created', response: { id: 'resp_probe', status: 'in_progress' } },
        { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
        { type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'PROBE_OK' },
        { type: 'response.output_item.done', output_index: 0, item },
        { type: 'response.completed', response: { id: 'resp_probe', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
      ];
      for (const event of events) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      response.end();
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });
  try {
    await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
    const port = provider.address().port;
    const catalog = path.resolve(__dirname, '../../docs/upstream/model-catalog-0.153.2.json');
    fs.writeFileSync(path.join(directory, 'config.toml'), [
      `model_catalog_json = ${JSON.stringify(catalog)}`,
      'model = "gpt-5.4"',
      'model_provider = "openai"',
      `openai_base_url = "http://127.0.0.1:${port}/v1"`,
      'web_search = "live"',
      'approval_policy = "never"',
      'sandbox_mode = "read-only"',
      'mcp_servers = {}',
      'include_environment_context = false',
      '[features]',
      'apps = false',
      'connectors = false',
      'shell_tool = false',
      'shell_snapshot = false',
      'apply_patch_freeform = false',
      'codex_hooks = false',
      'hooks = false',
      'skip_host_skill_discovery = true',
      'skill_mcp_dependency_install = false',
      'multi_agent = false',
      'collab = false',
      'code_mode = false',
      'code_mode_only = false',
      'js_repl = false',
      'view_image = false',
      '[apps._default]',
      'enabled = false',
      '',
    ].join('\n'), { mode: 0o600 });
    const executable = process.env.PROBE_CODEX_BIN || path.resolve(__dirname, '../../node_modules/.bin/codex');
    child = spawn(executable, ['app-server', '--listen', 'stdio://'], {
      cwd: directory,
      env: { HOME: directory, CODEX_HOME: directory, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, LANG: 'C.UTF-8' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const pending = new Map();
    let id = 0, buffer = '', stderr = '';
    const notifications = [];
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4096); });
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const message = JSON.parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (message.method) notifications.push(message);
        else if (pending.has(message.id)) {
          const { resolve, reject, timer } = pending.get(message.id);
          pending.delete(message.id); clearTimeout(timer);
          if (message.error) reject(new Error(JSON.stringify(message.error)));
          else resolve(message.result);
        }
      }
    });
    function request(method, params) {
      return new Promise((resolve, reject) => {
        const next = ++id;
        const timer = setTimeout(() => { pending.delete(next); reject(new Error(`${method} timeout ${stderr}`)); }, 15000);
        pending.set(next, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ id: next, method, params }) + '\n');
      });
    }
    await request('initialize', { clientInfo: { name: 'isolated_qualification', version: '1' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    await request('account/login/start', { type: 'apiKey', apiKey: 'synthetic-test-token' });
    const config = await request('config/read', { includeLayers: false });
    assert.deepEqual(config.config.mcp_servers ?? {}, {});
    const { thread } = await request('thread/start', {
      cwd: directory, ephemeral: true, environments: [], runtimeWorkspaceRoots: [], selectedCapabilityRoots: [],
      approvalPolicy: 'never', sandbox: 'read-only',
      dynamicTools: [{ type: 'function', name: 'project_execute', description: 'Run only inside the server-selected project sandbox.', inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false } }],
    });
    await request('turn/start', { threadId: thread.id, environments: [], input: [{ type: 'text', text: 'Qualification only.', text_elements: [] }] });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && !notifications.some((n) => n.method === 'turn/completed')) await new Promise((r) => setTimeout(r, 50));
    assert(notifications.some((n) => n.method === 'turn/completed'), stderr);
    assert(frames.length, JSON.stringify(notifications.filter((n) => n.method === 'error')));
    const inference = frames.find((f) => Array.isArray(f.body.tools));
    assert(inference, JSON.stringify(frames.map((f) => ({ url: f.url, keys: Object.keys(f.body) }))));
    const tools = inference.body.tools.map((t) => ({ type: t.type, name: t.name, tools: t.tools?.map((v) => v.name) }));
    console.log(JSON.stringify({ requestCount: frames.length, tools, mcp: config.config.mcp_servers ?? {}, turn: notifications.find((n) => n.method === 'turn/completed')?.params?.turn?.status }, null, 2));
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGKILL');
      await new Promise((resolve) => child.once('close', resolve));
    }
    provider.closeAllConnections();
    await new Promise((resolve) => provider.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
