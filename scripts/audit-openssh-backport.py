"""Verify the fixed backport; retain every raw Trivy finding without filtering."""
import json
import os
from pathlib import Path
import sys

VERSION = '1:10.6p1-1~webui13.1'
PACKAGES = {'openssh-common': 'openssh', 'openssh-client-gssapi': 'openssh-gssapi'}
# Individually verified against official OpenSSH 10.4/10.6 release notes.
FIXED_UPSTREAM = {'CVE-2026-60002', 'CVE-2026-106583', 'CVE-2026-59999',
                  'CVE-2026-60000', 'CVE-2026-106553', 'CVE-2026-106555'}
CHECKS = ('ssh_command', 'scp_sftp_legacy_scp_rekey', 'strict_host_key_rejection',
          'unsafe_username_rejection', 'git_clone_commit_push_ls_remote_fetch_fast_forward')


def audit(report, evidence):
    if (evidence.get('packages') != dict.fromkeys(PACKAGES, VERSION)
            or not evidence.get('ssh_version', '').startswith('OpenSSH_10.6p1 ')
            or evidence.get('production_uid') != 11002
            or any(evidence.get(key) != 'passed' for key in CHECKS)
            or not evidence.get('gssapi_options', '').startswith('passed;')):
        raise ValueError('Missing corrected client version or real transfer/security checks')
    installed = {p['Name']: p for r in report.get('Results', []) if r.get('Type') == 'debian'
                 for p in r.get('Packages', []) if p['Name'].startswith('openssh-')}
    if installed.keys() != PACKAGES.keys():
        raise ValueError(f'Unexpected OpenSSH package inventory: {list(installed)}')
    for name, source in PACKAGES.items():
        p = installed[name]
        if (p.get('Version'), p.get('Release'), p.get('Epoch'), p.get('Arch'), p.get('SrcName'),
                p.get('SrcVersion'), p.get('SrcRelease'), p.get('SrcEpoch')) != (
                '10.6p1', '1~webui13.1', 1, 'amd64', source, '10.6p1', '1~webui13.1', 1):
            raise ValueError(f'Unexpected binary/source package version: {name}')
    retained = []
    for result in report.get('Results', []):
        for finding in result.get('Vulnerabilities', []):
            if not finding['PkgName'].startswith('openssh-'):
                continue
            if (result.get('Type') != 'debian' or finding['PkgName'] not in PACKAGES
                    or finding['InstalledVersion'] != VERSION
                    or finding['VulnerabilityID'] not in FIXED_UPSTREAM
                    or finding.get('FixedVersion')):
                raise ValueError(f'New/unreviewed SSH finding; do not waive: {finding}')
            retained.append({k: finding[k] for k in ('PkgName', 'VulnerabilityID', 'Severity')})
    return {'delivered_version': VERSION, 'functional_tests': 'passed',
            'raw_findings_retained': retained,
            'interpretation': 'Known CVEs fixed in pinned upstream sources; Debian Trixie has no fixed-version metadata. No finding removed.'}


def main():
    report, evidence = (json.loads(Path(p).read_text()) for p in sys.argv[1:])
    result = audit(report, evidence)
    print(json.dumps(result, indent=2))
    if summary := os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(summary, 'a') as out:
            out.write('### OpenSSH client correction\n\n'
                      f'- Real rebuilt package version: **{VERSION}**\n'
                      '- SSH/SFTP/SCP/Git transfers and negative security checks passed as UID 11002.\n'
                      f"- Known source-fixed findings still present in the raw report: **{len(result['raw_findings_retained'])}**.\n"
                      '- No SSH finding is filtered. Unknown CVEs, changed versions or newly available Debian fixed-version metadata fail this review.\n')


if __name__ == '__main__':
    main()
