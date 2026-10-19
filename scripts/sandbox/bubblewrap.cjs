'use strict';

/** Operator-only, offline prototype. Deliberately NOT connected to the application. */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BWRAP = '/usr/bin/bwrap';
const PRLIMIT = '/usr/bin/prlimit';
const protectedPaths = [
  '/',
  '/app',
  '/appdata/codex-web',
  '/home',
  '/root',
  '/run',
  '/proc',
  '/sys',
  '/dev',
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/lib',
  '/lib64',
  '/opt',
  '/var',
];
function within(value, root) {
  const rel = path.relative(root, value);
  return (
    rel === '' ||
    (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel))
  );
}
function canonicalDirectory(value) {
  if (
    typeof value !== 'string' ||
    !path.isAbsolute(value) ||
    value.includes('\0')
  )
    throw new Error('An existing absolute workspace directory is required');
  const canonical = fs.realpathSync(value);
  if (!fs.statSync(canonical).isDirectory())
    throw new Error('Workspace is not a directory');
  return canonical;
}
function validatePolicy(input) {
  if (!input || input.mcp !== 'disabled' || input.network !== 'disabled')
    throw new Error('Prototype requires MCP and network disabled');
  if (
    !Array.isArray(input.workspaceRoots) ||
    input.workspaceRoots.length < 1 ||
    input.workspaceRoots.length > 8
  )
    throw new Error('Between one and eight workspace roots are required');
  const roots = input.workspaceRoots.map(canonicalDirectory);
  const protectedCanonicalPaths = protectedPaths.slice(1).flatMap((p) => {
    try {
      return [p, fs.realpathSync(p)];
    } catch {
      return [p];
    }
  });
  const broadRoots = ['/tmp', '/appdata'].flatMap((p) => {
    try {
      return [p, fs.realpathSync(p)];
    } catch {
      return [p];
    }
  });
  for (const root of roots) {
    if (
      broadRoots.includes(root) ||
      root === '/' ||
      protectedCanonicalPaths.some((p) => within(root, p) || within(p, root))
    )
      throw new Error('Protected or overly broad workspace root');
  }
  for (let i = 0; i < roots.length; i++) {
    if (
      roots.some(
        (root, j) =>
          i !== j && (within(roots[i], root) || within(root, roots[i])),
      )
    )
      throw new Error(
        'Overlapping workspace roots are not accepted by this prototype',
      );
  }
  const cwd = canonicalDirectory(input.cwd);
  const index = roots.findIndex((root) => within(cwd, root));
  if (index === -1)
    throw new Error('Working directory is outside project workspaces');
  return {
    roots,
    cwd,
    sandboxCwd: path.posix.join(
      '/workspace',
      String(index),
      path.relative(roots[index], cwd),
    ),
  };
}

/** Classic BPF: fail closed on a different ABI, including the x32 syscall ABI. */
function seccompFilter(arch = process.arch) {
  if (arch !== 'x64')
    throw new Error('Prototype seccomp is validated only on Linux x86_64');
  const errno = 0x00050000 | 1; // SECCOMP_RET_ERRNO | EPERM
  const instructions = [
    [0x20, 0, 0, 4],
    [0x15, 1, 0, 0xc000003e],
    [0x06, 0, 0, 0x80000000],
    [0x20, 0, 0, 0],
    [0x45, 0, 1, 0x40000000],
    [0x06, 0, 0, errno],
  ];
  const denied = [
    // All network socket operations, including pathname Unix sockets in bind mounts.
    ...Array.from({ length: 15 }, (_, i) => 41 + i),
    288,
    299,
    307,
    // ptrace, mount/namespace escape, keys, kernel attack surfaces, inherited process handles.
    101,
    155,
    165,
    166,
    167,
    168,
    169,
    175,
    176,
    246,
    248,
    249,
    250,
    272,
    298,
    303,
    304,
    308,
    310,
    311,
    313,
    320,
    321,
    323,
    // io_uring could bypass socket syscall filters; new mount API; clone3; pidfd_getfd.
    425,
    426,
    427,
    428,
    429,
    430,
    431,
    432,
    438,
    442,
  ];
  for (const nr of new Set(denied))
    instructions.push([0x15, 0, 1, nr], [0x06, 0, 0, errno]);
  // glibc posix_spawn falls back to ordinary clone only on ENOSYS, not EPERM.
  // Ordinary children remain in our namespaces, seccomp and resource limits.
  instructions.push([0x15, 0, 1, 435], [0x06, 0, 0, 0x00050000 | 38]);
  instructions.push([0x06, 0, 0, 0x7fff0000]);
  const buffer = Buffer.alloc(instructions.length * 8);
  instructions.forEach(([code, jt, jf, k], i) => {
    buffer.writeUInt16LE(code, i * 8);
    buffer[i * 8 + 2] = jt;
    buffer[i * 8 + 3] = jf;
    buffer.writeUInt32LE(k >>> 0, i * 8 + 4);
  });
  return buffer;
}

/** Pinned directory FDs avoid rebinding an exchanged path after validation. */
function prepareLaunch(input, argv) {
  if (process.platform !== 'linux')
    throw new Error('Linux is required; no unconfined fallback');
  if (process.getuid() === 0)
    throw new Error('Prototype must run as a non-root user');
  if (
    !Array.isArray(argv) ||
    !argv.length ||
    argv.some((a) => typeof a !== 'string' || a.includes('\0')) ||
    !path.isAbsolute(argv[0])
  )
    throw new Error('An explicit executable and argument vector are required');
  const filter = seccompFilter();
  const policy = validatePolicy(input);
  fs.accessSync(BWRAP, fs.constants.X_OK);
  fs.accessSync(PRLIMIT, fs.constants.X_OK);
  const fds = [];
  let scratch;
  try {
    const args = [
      '--unshare-all',
      '--unshare-user',
      '--unshare-cgroup',
      '--disable-userns',
      '--die-with-parent',
      '--new-session',
      '--cap-drop',
      'ALL',
      '--clearenv',
      '--setenv',
      'PATH',
      '/usr/bin:/bin',
      '--setenv',
      'LANG',
      'C.UTF-8',
      '--setenv',
      'HOME',
      '/home/agent',
      '--setenv',
      'CODEX_HOME',
      '/home/agent/.codex',
      '--setenv',
      'TMPDIR',
      '/tmp',
      '--ro-bind',
      '/usr',
      '/usr',
      '--symlink',
      'usr/bin',
      '/bin',
      '--symlink',
      'usr/sbin',
      '/sbin',
      '--symlink',
      'usr/lib',
      '/lib',
      '--symlink',
      'usr/lib64',
      '/lib64',
      '--dir',
      '/etc',
      '--dir',
      '/workspace',
      '--dir',
      '/home',
      '--size',
      '67108864',
      '--tmpfs',
      '/tmp',
      '--size',
      '16777216',
      '--tmpfs',
      '/home/agent',
      '--dir',
      '/home/agent/.codex',
      '--size',
      '1048576',
      '--tmpfs',
      '/run',
      '--proc',
      '/proc',
      '--remount-ro',
      '/proc',
      '--dev',
      '/dev',
    ];
    policy.roots.forEach((root, index) => {
      const fd = fs.openSync(
        root,
        fs.constants.O_RDONLY |
          fs.constants.O_DIRECTORY |
          fs.constants.O_NOFOLLOW,
      );
      fds.push(fd);
      if (fs.realpathSync(`/proc/self/fd/${fd}`) !== root)
        throw new Error('Workspace changed during validation');
      args.push('--bind-fd', String(3 + index), `/workspace/${index}`);
    });
    scratch = fs.mkdtempSync('/tmp/codex-bwrap-filter-');
    const filterPath = path.join(scratch, 'seccomp.bpf');
    fs.writeFileSync(filterPath, filter, { mode: 0o600, flag: 'wx' });
    fds.push(
      fs.openSync(filterPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW),
    );
    fs.unlinkSync(filterPath);
    fs.rmdirSync(scratch);
    scratch = undefined;
    args.push(
      '--seccomp',
      String(3 + fds.length - 1),
      '--remount-ro',
      '/',
      '--chdir',
      policy.sandboxCwd,
      '--',
      ...argv,
    );
    return {
      fds,
      executable: PRLIMIT,
      args: [
        '--as=536870912',
        '--cpu=5',
        '--fsize=16777216',
        '--nofile=128',
        '--nproc=256',
        '--core=0',
        '--',
        BWRAP,
        ...args,
      ],
    };
  } catch (error) {
    for (const fd of fds) fs.closeSync(fd);
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    throw error;
  }
}

async function runSandbox(
  input,
  argv,
  { timeoutMs = 10000, signal: abortSignal } = {},
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
    throw new Error('Invalid prototype timeout');
  abortSignal?.throwIfAborted();
  const launch = prepareLaunch(input, argv);
  let child;
  try {
    child = spawn(launch.executable, launch.args, {
      cwd: '/',
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe', ...launch.fds],
    });
  } finally {
    for (const fd of launch.fds) fs.closeSync(fd);
  }
  return new Promise((resolve, reject) => {
    let stdout = '',
      stderr = '',
      stopped = null;
    const stop = (reason) => {
      stopped = reason;
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') reject(error);
        }
      }
    };
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    const abort = () => stop('cancelled');
    abortSignal?.addEventListener('abort', abort, { once: true });
    if (abortSignal?.aborted) abort();
    const capture = (stream) => (data) => {
      if (stream === 'stdout') stdout += data.toString();
      else stderr += data.toString();
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 65536)
        stop('output-limit');
      stdout = stdout.slice(0, 65536);
      stderr = stderr.slice(0, 65536);
    };
    child.stdout.on('data', capture('stdout'));
    child.stderr.on('data', capture('stderr'));
    child.on('error', (error) => {
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', abort);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', abort);
      resolve({ code, signal, stopped, stdout, stderr });
    });
  });
}

module.exports = { validatePolicy, seccompFilter, prepareLaunch, runSandbox };
