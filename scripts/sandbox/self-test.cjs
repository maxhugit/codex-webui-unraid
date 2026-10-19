'use strict';

/** Uses only disposable canaries. Never reads real credentials or modifies projects. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { runSandbox } = require('./bubblewrap.cjs');

async function listen(server, ...args) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(...args, resolve);
  });
}
async function connect(...args) {
  await new Promise((resolve, reject) => {
    const client = net.connect(...args);
    client.once('error', reject);
    client.once('connect', () => client.end());
    client.once('close', resolve);
  });
}
async function main() {
  if (process.platform !== 'linux' || process.arch !== 'x64')
    throw new Error('Linux x86_64 is required; test not skipped');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-bwrap-probe-'));
  const a = path.join(base, 'project-a');
  const b = path.join(base, 'project-b');
  const outside = path.join(base, 'private');
  for (const dir of [a, b, outside]) fs.mkdirSync(dir, { mode: 0o700 });
  fs.writeFileSync(path.join(outside, 'canary.txt'), 'PRIVATE_TEST_CANARY');
  fs.writeFileSync(path.join(b, 'second.txt'), 'SECOND_WORKSPACE');
  fs.symlinkSync(path.join(outside, 'canary.txt'), path.join(a, 'escape'));
  fs.symlinkSync('/', path.join(a, 'outer-root'));
  let connections = 0;
  const socketPath = path.join(a, 'mcp-test.sock');
  const socket = net.createServer((connection) => {
    connections++;
    connection.end();
  });
  const tcp = net.createServer((connection) => {
    connections++;
    connection.end();
  });
  const results = [];
  const policy = {
    workspaceRoots: [a],
    cwd: a,
    network: 'disabled',
    mcp: 'disabled',
  };
  const probe = async (name, code, extra = {}) => {
    const result = await runSandbox({ ...policy, ...extra }, [
      '/usr/bin/python3',
      '-I',
      '-c',
      code,
    ]);
    const passed =
      result.code === 0 &&
      result.stopped === null &&
      result.stdout.trim() === 'PASS';
    results.push({
      name,
      passed,
      ...(!passed
        ? {
            exitCode: result.code,
            stopped: result.stopped,
            diagnostic: result.stderr.slice(-1000),
            output: result.stdout.slice(-1000),
          }
        : {}),
    });
    return passed;
  };
  try {
    await listen(socket, socketPath);
    await listen(tcp, 0, '127.0.0.1');
    const port = tcp.address().port;
    await connect(socketPath);
    await connect(port, '127.0.0.1');
    results.push({
      name: 'control-mcp-listeners-are-reachable-outside-sandbox',
      passed: connections === 2,
    });
    connections = 0;
    // Baseline is mandatory: an unusable sandbox must never masquerade as successful denial tests.
    if (
      !(await probe(
        'sandbox-starts-and-writes-authorized-workspace',
        `
import os
assert os.getcwd() == '/workspace/0'
open('allowed.txt', 'w').write('WORKSPACE_WRITE')
assert open('allowed.txt').read() == 'WORKSPACE_WRITE'
print('PASS')`,
      ))
    )
      return report();
    results.push({
      name: 'authorized-write-reaches-only-test-workspace',
      passed:
        fs.readFileSync(path.join(a, 'allowed.txt'), 'utf8') ===
        'WORKSPACE_WRITE',
    });
    await probe(
      'second-authorized-workspace-is-accessible',
      `
assert open('/workspace/1/second.txt').read() == 'SECOND_WORKSPACE'
print('PASS')`,
      { workspaceRoots: [a, b] },
    );
    await probe(
      'other-project-and-secret-paths-are-hidden',
      `
import os
for p in ${JSON.stringify([path.join(outside, 'canary.txt'), b, '/home/codex/.codex', '/run/secrets', '/app', '/appdata', '/sys'])}:
 assert not os.path.exists(p), p
print('PASS')`,
    );
    await probe(
      'traversal-and-symlink-escape-cannot-read-canary',
      `
for p in ['escape', 'outer-root${outside}/canary.txt', '../../${outside.slice(1)}/canary.txt']:
 try: open(p).read()
 except (OSError, PermissionError): pass
 else: raise AssertionError('escaped via '+p)
print('PASS')`,
    );
    await probe(
      'runtime-and-root-are-read-only',
      `
for p in ['/usr/.codex-probe-write', '/etc/.codex-probe-write', '/outside-workspace']:
 try: open(p,'w').write('BAD')
 except OSError: pass
 else: raise AssertionError('writable '+p)
open('/tmp/scratch', 'w').write('TEMP')
print('PASS')`,
    );
    // Poisoned parent variables must not reach the sandbox or loader.
    const poisoned = {
      CODEX_PROBE_SECRET: 'SYNTHETIC_SECRET',
      HTTP_PROXY: 'http://127.0.0.1:9',
      MCP_TEST_TOKEN: 'SYNTHETIC_MCP',
      NODE_OPTIONS: '--throw-deprecation',
      BASH_ENV: '/not/a/real/file',
      PYTHONPATH: outside,
      LD_PRELOAD: '/not/a/real/library.so',
      LD_LIBRARY_PATH: outside,
      OPENAI_API_KEY: 'SYNTHETIC_OPENAI_KEY',
      MCP_SERVER_URL: 'http://127.0.0.1:9',
    };
    const saved = Object.fromEntries(
      Object.keys(poisoned).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, poisoned);
    try {
      await probe(
        'environment-clean-and-codex-home-empty',
        `
import os
for k in ${JSON.stringify(Object.keys(poisoned))}: assert k not in os.environ, k
assert os.environ['CODEX_HOME'] == '/home/agent/.codex'
assert os.listdir('/home/agent/.codex') == []
assert not any('TOKEN' in k or 'API_KEY' in k or 'AUTH' in k for k in os.environ)
print('PASS')`,
      );
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    await probe(
      'private-proc-and-no-privileges',
      `
import os
assert not os.path.exists('/proc/${process.pid}/cmdline')
status = open('/proc/self/status').read()
assert 'NoNewPrivs:\t1' in status
assert 'CapEff:\t0000000000000000' in status
assert 'Seccomp:\t2' in status
assert os.getuid() != 0
print('PASS')`,
    );
    const inherited = fs.openSync(
      outside,
      fs.constants.O_RDONLY | fs.constants.O_DIRECTORY,
    );
    try {
      await probe(
        'no-inherited-directory-socket-or-filter-descriptors',
        `
import os
for entry in os.listdir('/proc/self/fd'):
 fd = int(entry)
 if fd < 3: continue
 try: target = os.readlink('/proc/self/fd/'+entry)
 except FileNotFoundError: continue
 raise AssertionError('unexpected inherited fd '+entry+' '+target)
assert os.read(0,1) == b''
print('PASS')`,
      );
    } finally {
      fs.closeSync(inherited);
    }
    await probe(
      'mcp-http-tcp-unix-and-abstract-sockets-blocked',
      `
import socket
targets = [(socket.AF_INET, ('127.0.0.1',${port})), (socket.AF_INET, ('192.0.2.1',80)), (socket.AF_INET6, ('::1',${port})), (socket.AF_UNIX, '/workspace/0/mcp-test.sock'), (socket.AF_UNIX, '\\x00codex-mcp-test')]
for family, target in targets:
 try:
  s=socket.socket(family,socket.SOCK_STREAM); s.settimeout(.2); s.connect(target)
 except OSError: pass
 else: raise AssertionError('connected '+str(target))
try: socket.socketpair()
except OSError: pass
else: raise AssertionError('socketpair allowed')
print('PASS')`,
    );
    results.push({
      name: 'mcp-test-listeners-received-no-connections',
      passed: connections === 0,
    });
    await probe(
      'nested-namespace-ptrace-io-uring-and-x32-denied',
      `
import ctypes, errno
c=ctypes.CDLL(None,use_errno=True)
for nr in [272,308,101,425,438,0x40000029]:
 ctypes.set_errno(0)
 result=c.syscall(ctypes.c_long(nr),0,0,0,0,0,0)
 assert result == -1 and ctypes.get_errno() == errno.EPERM, (nr,result,ctypes.get_errno())
print('PASS')`,
    );
    await probe(
      'subprocesses-inherit-filesystem-and-network-policy',
      `
import subprocess
r=subprocess.run(['/usr/bin/python3','-I','-c',"import socket,os; assert not os.path.exists('/app'); socket.socket()"],capture_output=True)
assert r.returncode != 0 and b'Operation not permitted' in r.stderr
print('PASS')`,
    );
    await probe(
      'cpu-memory-file-and-descriptor-limits-installed',
      `
import resource
for key, maximum in [(resource.RLIMIT_AS,536870912),(resource.RLIMIT_CPU,5),(resource.RLIMIT_FSIZE,16777216),(resource.RLIMIT_NOFILE,128),(resource.RLIMIT_NPROC,256),(resource.RLIMIT_CORE,0)]:
 assert resource.getrlimit(key)[1] <= maximum
print('PASS')`,
    );
    const timeout = await runSandbox(
      policy,
      [
        '/usr/bin/python3',
        '-I',
        '-c',
        `
import os,time
if os.fork()==0:
 os.setsid()
 if os.fork()==0:
  open('/workspace/0/child-ready','w').write('READY')
  time.sleep(2)
  open('/workspace/0/SURVIVED','w').write('BAD')
 os._exit(0)
time.sleep(20)`,
      ],
      { timeoutMs: 500 },
    );
    await new Promise((resolve) => setTimeout(resolve, 2400));
    results.push({
      name: 'timeout-kills-detached-double-fork-descendants',
      passed:
        timeout.stopped === 'timeout' &&
        fs.existsSync(path.join(a, 'child-ready')) &&
        !fs.existsSync(path.join(a, 'SURVIVED')),
    });
    const output = await runSandbox(policy, [
      '/usr/bin/python3',
      '-I',
      '-c',
      "while True: print('x'*4096,flush=True)",
    ]);
    results.push({
      name: 'excessive-output-terminates-execution',
      passed: output.stopped === 'output-limit',
    });
    // Deliberately broken sandbox executable: the payload must never run unconfined.
    const failure = await runSandbox(policy, [
      '/not-installed/prototype-payload',
    ]);
    results.push({
      name: 'missing-executable-fails-without-fallback',
      passed:
        Number.isInteger(failure.code) &&
        failure.code !== 0 &&
        failure.stopped === null,
    });
    // Existing hardlinks are data already inside a permitted tree: record, never hide, this boundary.
    fs.linkSync(
      path.join(outside, 'canary.txt'),
      path.join(a, 'preexisting-hardlink'),
    );
    await probe(
      'documents-preexisting-hardlink-limit',
      `
assert open('preexisting-hardlink').read() == 'PRIVATE_TEST_CANARY'
print('PASS')`,
    );
    return report();
  } finally {
    socket.close();
    tcp.close();
    fs.rmSync(base, { recursive: true, force: true });
  }
  function report() {
    const passed = results.every((test) => test.passed);
    console.log(
      JSON.stringify(
        {
          prototype: 'bubblewrap-offline-v1',
          platform: process.platform,
          architecture: process.arch,
          passed,
          isolationValidatedForStandardUsers: false,
          standardUsersEnabled: false,
          productionReady: false,
          mcp: 'disabled',
          network: 'disabled',
          tests: results,
          remainingGates: [
            'Preexisting hardlinks and concurrent outside writes need a storage/ownership policy.',
            'Per-project resource quotas are not provided by RLIMIT_NPROC/AS.',
            'No real Codex client, MCP broker, API authorization or resume/subagent integration is validated.',
          ],
        },
        null,
        2,
      ),
    );
    if (!passed) process.exitCode = 1;
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(
      JSON.stringify({
        passed: false,
        standardUsersEnabled: false,
        error: error.message,
      }),
    );
    process.exitCode = 1;
  });
module.exports = { main };
