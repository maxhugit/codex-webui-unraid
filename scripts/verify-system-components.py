"""Inventory absent implementations and exercise retained GPG/SSH client tools."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

FORBIDDEN = {'tpm2daemon', 'systemd-homed', 'systemd-homework', 'sshd', 'sshd-auth', 'sshd-session'}


def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, timeout=60, **kwargs).strip()


def main():
    installed = {}
    for line in run('dpkg-query', '-W', '-f=${db:Status-Abbrev}\t${Package}\t${Version}\n').splitlines():
        status, name, version = line.split('\t')
        if status.startswith('ii'):
            installed[name] = version
    forbidden_packages = FORBIDDEN | {'openssh-server'}
    if forbidden_packages & installed.keys():
        raise RuntimeError('Excluded component package is installed; review applicability')
    def inventory_error(error):
        raise error

    checked = 0
    # Inspect the immutable image, including files not owned by Debian packages.
    # /bin, /sbin and /lib are merged into /usr on Debian Trixie.
    for base in ('/usr', '/opt', '/root', '/home'):
        for directory, _, files in os.walk(base, onerror=inventory_error):
            for name in files:
                checked += 1
                if name in FORBIDDEN or name in {f'{n}.service' for n in FORBIDDEN}:
                    raise RuntimeError(f'Excluded implementation exists: {directory}/{name}')
    # The entrypoint later restores this compressed toolchain into /home/codex.
    seed_members = run('tar', '--zstd', '-tf', '/opt/codex-home-seed.tar.zst').splitlines()
    for member in seed_members:
        name = Path(member.rstrip('/')).name
        if name in FORBIDDEN or name in {f'{n}.service' for n in FORBIDDEN}:
            raise RuntimeError(f'Excluded implementation exists in toolchain seed: {member}')
    if len(seed_members) < 100:
        raise RuntimeError('Incomplete toolchain seed inventory')
    if checked < 100:
        raise RuntimeError('Incomplete filesystem inventory')

    with tempfile.TemporaryDirectory(prefix='webui-security-smoke-') as directory:
        root = Path(directory)
        home = root / 'gnupg'
        home.mkdir(mode=0o700)
        env = {**os.environ, 'GNUPGHOME': str(home)}
        try:
            run('gpg', '--batch', '--pinentry-mode', 'loopback', '--passphrase', '',
                '--quick-generate-key', 'WebUI CI <ci@example.invalid>', 'ed25519', 'sign', '0', env=env)
            data = root / 'payload'
            data.write_text('retained GPG and SSH functionality\n')
            signature = root / 'payload.sig'
            run('gpg', '--batch', '--yes', '--pinentry-mode', 'loopback', '--passphrase', '',
                '--detach-sign', '--output', str(signature), str(data), env=env)
            run('gpg', '--batch', '--verify', str(signature), str(data), env=env)
            # Exercise the Git signing integration, without user/global config.
            repo = root / 'repo'
            run('git', 'init', '-q', str(repo))
            git = ['git', '-C', str(repo), '-c', 'user.name=WebUI CI', '-c',
                   'user.email=ci@example.invalid', '-c', 'user.signingkey=ci@example.invalid',
                   '-c', 'gpg.format=openpgp', '-c', 'gpg.program=gpg']
            run(*git, 'commit', '--allow-empty', '-S', '-m', 'GPG smoke test', env=env)
            run(*git, 'verify-commit', 'HEAD', env=env)
            run('gpgconf', '--list-dirs', env=env)
        finally:
            run('gpgconf', '--kill', 'all', env=env)

        data = root / 'ssh-payload'
        data.write_text('SSH agent signing smoke test\n')
        key = root / 'ssh-key'
        run('ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(key))
        run('ssh-keygen', '-lf', str(key) + '.pub')
        config = run('ssh', '-F', '/dev/null', '-G', '-o', 'BatchMode=yes',
                     '-o', 'StrictHostKeyChecking=yes', 'git@example.invalid')
        if 'user git' not in config or 'stricthostkeychecking true' not in config:
            raise RuntimeError('SSH configuration regression')
        agent_socket = root / 'agent.sock'
        agent = subprocess.Popen(['ssh-agent', '-D', '-a', str(agent_socket)], stdout=subprocess.DEVNULL,
                                 stderr=subprocess.PIPE)
        try:
            import time
            for _ in range(100):
                if agent_socket.exists():
                    break
                if agent.poll() is not None:
                    raise RuntimeError('SSH agent exited unexpectedly')
                time.sleep(0.05)
            agent_env = {**os.environ, 'SSH_AUTH_SOCK': str(agent_socket)}
            run('ssh-add', str(key), env=agent_env)
            public = Path(str(key) + '.pub').read_text().strip()
            allowed = root / 'allowed-signers'
            allowed.write_text(f'ci@example.invalid {public}\n')
            # -U requires the private-key operation to be performed by ssh-agent.
            run('ssh-keygen', '-Y', 'sign', '-U', '-f', str(key) + '.pub', '-n', 'webui-ci', str(data), env=agent_env)
            with data.open() as payload:
                run('ssh-keygen', '-Y', 'verify', '-f', str(allowed), '-I', 'ci@example.invalid',
                    '-n', 'webui-ci', '-s', str(data) + '.sig', stdin=payload)
            run('ssh-add', '-D', env=agent_env)
        finally:
            agent.terminate()
            agent.communicate(timeout=10)
    print(json.dumps({'schema_version': 1, 'installed_packages': installed,
                      'excluded_implementations_found': [], 'files_checked': checked, 'seed_members_checked': len(seed_members),
                      'gpg_sign_verify_and_git': 'passed', 'ssh_keys_agent_sign_verify_config': 'passed',
                      'scope': 'immutable container filesystem; excludes host, mounts and user-installed tools'}, indent=2))


if __name__ == '__main__':
    main()
