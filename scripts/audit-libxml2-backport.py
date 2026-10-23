"""Bind fixed libxml2 sources to real Office conversions without filtering Trivy."""
import json
import os
from pathlib import Path
import sys

VERSION = '2.12.7+dfsg+really2.9.14-2.1+deb13u3+webui1'
REVIEWED = {'CVE-2026-6653', 'CVE-2026-74860', 'CVE-2026-86138', 'CVE-2026-86139',
            'CVE-2026-86140', 'CVE-2026-86142', 'CVE-2026-86143', 'CVE-2026-86144'}
PATCHES = json.loads((Path(__file__).resolve().parent.parent / 'security/libxml2-patches/manifest.json').read_text())


def audit(report, evidence):
    source = evidence.get('source_review', {})
    if (evidence.get('package_version') != VERSION or evidence.get('production_uid') != 11002
            or evidence.get('lxml_runtime_libxml2') != [2, 9, 14]
            or len(evidence.get('lxml_system_linkage', [])) != 1
            or not evidence.get('office_xml_consumers')
            or len(evidence.get('conversions', [])) != 18
            or evidence.get('pdf_text_pages_images') != 'passed'
            or evidence.get('word_styles_tables_unicode_roundtrip') != 'passed'
            or evidence.get('calc_formula_cached_value') != 42
            or evidence.get('slides_unicode_roundtrip') != 'passed'
            or evidence.get('strict_xml_rejected_in_lxml') is not True
            or evidence.get('native_python_bindings_installed') is not False
            or source.get('patches') != PATCHES
            or source.get('uri_overflow_guard_preexisting') is not True
            or any(source.get(k) != 'passed' for k in ('upstream_regressions', 'focused_xml_regressions', 'exported_symbols_check'))):
        raise ValueError('Missing fixed-source, shared-library or real Office evidence')
    packages = [p for r in report.get('Results', []) if r.get('Type') == 'debian'
                for p in r.get('Packages', []) if p['Name'] == 'libxml2']
    if len(packages) != 1:
        raise ValueError('Missing libxml2 inventory')
    p = packages[0]
    if (p.get('Version'), p.get('Release'), p.get('Arch'), p.get('SrcName'),
            p.get('SrcVersion'), p.get('SrcRelease')) != (
            '2.12.7+dfsg+really2.9.14', '2.1+deb13u3+webui1', 'amd64', 'libxml2',
            '2.12.7+dfsg+really2.9.14', '2.1+deb13u3+webui1'):
        raise ValueError('Unexpected libxml2 binary/source version')
    retained = []
    for r in report.get('Results', []):
        for v in r.get('Vulnerabilities', []):
            if v['PkgName'] != 'libxml2':
                continue
            if (r.get('Type') != 'debian' or v['InstalledVersion'] != VERSION
                    or v['VulnerabilityID'] not in REVIEWED or v.get('FixedVersion')):
                raise ValueError(f'New/unreviewed libxml2 finding: {v}')
            retained.append({k: v[k] for k in ('VulnerabilityID', 'Severity')})
    return {'delivered_version': VERSION, 'office_conversions': 18,
            'raw_findings_retained': retained,
            'classification': 'Five native HIGH and the CRITICAL patched; Python-only code patched but not shipped; URI guard already present. No Trivy finding removed.'}


def main():
    report, evidence = (json.loads(Path(p).read_text()) for p in sys.argv[1:])
    result = audit(report, evidence)
    print(json.dumps(result, indent=2))
    if summary := os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(summary, 'a') as out:
            out.write('### libxml2 and Office verification\n\n'
                      f'- Real patched package: **{VERSION}**; lxml loads the same system library.\n'
                      '- Upstream XML regressions, exported symbols and 18 Office conversions passed.\n'
                      '- PDF text/pages/images, formula result 42, roundtrips and malformed XML checked.\n'
                      '- No libxml2 finding filtered; reviewed vendor-metadata warnings remain in raw/final reports.\n')


if __name__ == '__main__':
    main()
