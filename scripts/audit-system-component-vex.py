"""Fail closed unless only exact reviewed HIGH package/CVE pairs are reclassified."""
from collections import Counter
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
ALLOWED = {
    'CVE-2026-24882': {'dirmngr', 'gnupg', 'gnupg-l10n', 'gpg', 'gpg-agent', 'gpgconf', 'gpgsm'},
    'CVE-2026-16742': {'libsystemd0', 'libudev1'},
    **{c: {'openssh-client'} for c in ('CVE-2026-59999', 'CVE-2026-60000', 'CVE-2026-106553', 'CVE-2026-106555')},
}


def reviewed_keys(vex, assessment, evidence):
    expected_pairs = {(p, c) for c, packages in ALLOWED.items() for p in packages}
    if len(assessment) != 13 or {(r['package'], r['cve']) for r in assessment} != expected_pairs:
        raise ValueError('Unexpected assessment scope')
    if (evidence.get('schema_version') != 1 or evidence.get('excluded_implementations_found') != []
            or evidence.get('files_checked', 0) < 100
            or evidence.get('gpg_sign_verify_and_git') != 'passed'
            or evidence.get('ssh_keys_agent_sign_verify_config') != 'passed'):
        raise ValueError('Missing image inventory or functional evidence')
    for row in assessment:
        if evidence['installed_packages'].get(row['package']) != row['version']:
            raise ValueError(f"Package version changed: {row['package']}; re-review required")
        if not row['purl'].startswith(f"pkg:deb/debian/{row['package']}@") or '?arch=' not in row['purl']:
            raise ValueError('Package URL must specify a version and architecture')
    expected = {('debian', r['package'], r['purl'], r['cve'], 'HIGH') for r in assessment}
    actual = set()
    for statement in vex['statements']:
        if (statement['status'], statement['justification']) != ('not_affected', 'vulnerable_code_not_present'):
            raise ValueError('Unexpected VEX decision')
        for product in statement['products']:
            actual.add(('debian', product['@id'].split('/')[2].split('@')[0], product['@id'],
                        statement['vulnerability']['name'], 'HIGH'))
    if actual != expected or len(vex['statements']) != 13:
        raise ValueError('VEX differs from exact reviewed package/CVE scope')
    return expected


def findings(report):
    if not any(r.get('Type') == 'debian' for r in report.get('Results', [])):
        raise ValueError('Missing Debian scan results')
    return Counter((r.get('Type'), v.get('PkgName'), v.get('PkgIdentifier', {}).get('PURL'),
                    v['VulnerabilityID'], v['Severity'])
                   for r in report['Results'] for v in r.get('Vulnerabilities', []))


def audit(before, after, allowed):
    old, new = findings(before), findings(after)
    expected = Counter({k: n for k, n in old.items() if k in allowed})
    if old - new != expected or new - old:
        raise ValueError('Filtering changed unreviewed findings or did not apply reviewed decisions')
    return {'before_high': sum(n for k, n in old.items() if k[-1] == 'HIGH'),
            'reviewed_system_high': sum(expected.values()),
            'after_high': sum(n for k, n in new.items() if k[-1] == 'HIGH'),
            'critical_retained': sum(n for k, n in new.items() if k[-1] == 'CRITICAL')}


def main():
    mode, evidence_path, *reports = sys.argv[1:]
    read = lambda path: json.loads(Path(path).read_text())
    vex = read(ROOT / 'security/system-components.openvex.json')
    assessment = read(ROOT / 'security/system-components-assessment.json')
    allowed = reviewed_keys(vex, assessment, read(evidence_path))
    if mode == 'prepare':
        combined = read(ROOT / 'security/linux-libc-dev.openvex.json')
        combined['@id'] = 'https://github.com/maxhugit/codex-webui-unraid/security/image-applicability-2026-10-22'
        combined['statements'] += vex['statements']
        Path(reports[0]).write_text(json.dumps(combined, indent=2) + '\n')
    elif mode == 'audit':
        result = audit(read(reports[0]), read(reports[1]), allowed)
        print(json.dumps(result, indent=2))
        if summary := os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(summary, 'a') as out:
                out.write('### System component applicability\n\n' + '\n'.join(f'- {k}: **{v}**' for k, v in result.items())
                          + '\n\nRaw, header-only and final reports plus image evidence are retained. '
                          'These are applicability decisions, not patched binaries or a host assessment.\n')
    else:
        raise ValueError('Expected prepare or audit')


if __name__ == '__main__':
    main()
