"""Exercise production SSH/Git clients against an isolated disposable SSH server."""
import json
import os
from pathlib import Path
import subprocess

ROOT = Path('/tmp/webui-ssh-test')


def run(*args, **kwargs):
    return subprocess.check_output(args, text=True, timeout=60, **kwargs).strip()


def main():
    if os.getuid() != 11002:
        raise RuntimeError('Test must run as the production user')
    version = subprocess.run(['ssh', '-V'], capture_output=True, text=True, check=True).stderr
    if not version.startswith('OpenSSH_10.6p1 '):
        raise RuntimeError(f'Unexpected SSH version: {version}')
    packages = {p: run('dpkg-query', '-W', '-f=${Version}', p)
                for p in ('openssh-common', 'openssh-client-gssapi')}
    if set(packages.values()) != {'1:10.6p1-1~webui13.1'}:
        raise RuntimeError(f'Unexpected package versions: {packages}')
    config = ROOT / 'config'
    config.write_text(f'''Host ssh-fixture
    HostName ssh-fixture
    User root
    IdentityFile {ROOT}/client-key
    IdentitiesOnly yes
    BatchMode yes
    StrictHostKeyChecking yes
    UserKnownHostsFile {ROOT}/known_hosts
    ConnectTimeout 10
    GSSAPIAuthentication no
    RekeyLimit 1K
''')
    ssh = ['ssh', '-F', str(config)]
    assert run(*ssh, 'ssh-fixture', 'printf ssh-ok') == 'ssh-ok'
    capabilities = run(*ssh, '-G', '-o', 'GSSAPIAuthentication=yes', '-o', 'GSSAPIKeyExchange=yes', 'ssh-fixture')
    assert 'gssapiauthentication yes' in capabilities and 'gssapikeyexchange yes' in capabilities
    # Force repeated ordinary key exchanges during a real encrypted transfer.
    payload = ROOT / 'payload.bin'
    payload.write_bytes(bytes(range(256)) * 4096)
    subprocess.run(['scp', '-F', str(config), str(payload), 'ssh-fixture:/tmp/payload.bin'], check=True, timeout=60)
    result = ROOT / 'returned.bin'
    subprocess.run(['scp', '-F', str(config), 'ssh-fixture:/tmp/payload.bin', str(result)], check=True, timeout=60)
    assert result.read_bytes() == payload.read_bytes()
    legacy = ROOT / 'legacy.bin'
    subprocess.run(['scp', '-O', '-F', str(config), 'ssh-fixture:/tmp/payload.bin', str(legacy)], check=True, timeout=60)
    assert legacy.read_bytes() == payload.read_bytes()
    batch = ROOT / 'sftp.batch'
    batch.write_text(f'put {payload} /tmp/sftp.bin\nget /tmp/sftp.bin {ROOT}/sftp-return.bin\n')
    run('sftp', '-F', str(config), '-b', str(batch), 'ssh-fixture')
    assert (ROOT / 'sftp-return.bin').read_bytes() == payload.read_bytes()

    # Refuse an untrusted host key; never disable verification for the fixture.
    wrong = ROOT / 'wrong-host-key'
    run('ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(wrong))
    wrong_hosts = ROOT / 'wrong-known-hosts'
    wrong_hosts.write_text('ssh-fixture ' + Path(str(wrong) + '.pub').read_text())
    refused = subprocess.run([*ssh, '-o', f'UserKnownHostsFile={wrong_hosts}', 'ssh-fixture', 'true'],
                             capture_output=True, text=True, timeout=20)
    assert refused.returncode != 0 and 'Host key verification failed' in refused.stderr
    for username in ('invalid$user', 'invalid\\user'):
        refused = subprocess.run(['ssh', '-F', '/dev/null', '-G', '-l', username, 'ssh-fixture'],
                                 capture_output=True, text=True, timeout=10)
        assert refused.returncode != 0 and 'username contains invalid characters' in refused.stderr

    env = {**os.environ, 'GIT_SSH_COMMAND': f'ssh -F {config}',
           'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}
    repo = ROOT / 'checkout'
    run('git', 'clone', 'ssh-fixture:/tmp/remote.git', str(repo), env=env)
    git = ['git', '-C', str(repo), '-c', 'user.name=WebUI CI', '-c', 'user.email=ci@example.invalid']
    (repo / 'README').write_text('Git over corrected SSH\n')
    run(*git, 'add', 'README', env=env)
    run(*git, 'commit', '-m', 'SSH smoke test', env=env)
    run(*git, 'push', 'origin', 'HEAD:refs/heads/smoke', env=env)
    expected = run(*git, 'rev-parse', 'HEAD', env=env)
    assert run(*git, 'ls-remote', 'origin', 'refs/heads/smoke', env=env).split()[0] == expected
    second = ROOT / 'second-checkout'
    run('git', 'clone', '--branch', 'smoke', 'ssh-fixture:/tmp/remote.git', str(second), env=env)
    (repo / 'README').write_text('Second Git commit\n')
    run(*git, 'commit', '-am', 'Fetch test', env=env)
    run(*git, 'push', 'origin', 'HEAD:refs/heads/smoke', env=env)
    run('git', '-C', str(second), 'fetch', 'origin', env=env)
    run('git', '-C', str(second), 'merge', '--ff-only', 'origin/smoke', env=env)
    assert (second / 'README').read_text() == 'Second Git commit\n'
    print(json.dumps({'ssh_version': version.strip(), 'packages': packages, 'production_uid': os.getuid(),
                      'ssh_command': 'passed', 'scp_sftp_legacy_scp_rekey': 'passed',
                      'strict_host_key_rejection': 'passed', 'unsafe_username_rejection': 'passed',
                      'gssapi_options': 'passed; no Kerberos realm exercised',
                      'git_clone_commit_push_ls_remote_fetch_fast_forward': 'passed'}, indent=2))


if __name__ == '__main__':
    main()
