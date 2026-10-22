"""Check that component decisions cannot hide other CVEs, packages or severities."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('system_audit', ROOT / 'scripts/audit-system-component-vex.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
VEX = json.loads((ROOT / 'security/system-components.openvex.json').read_text())
ASSESSMENT = json.loads((ROOT / 'security/system-components-assessment.json').read_text())


class SystemApplicabilityTests(unittest.TestCase):
    def setUp(self):
        self.evidence = {'schema_version': 1, 'files_checked': 1000, 'excluded_implementations_found': [],
                         'installed_packages': {r['package']: r['version'] for r in ASSESSMENT},
                         'gpg_sign_verify_and_git': 'passed', 'ssh_keys_agent_sign_verify_config': 'passed'}
        self.allowed = module.reviewed_keys(VEX, ASSESSMENT, self.evidence)
        self.findings = [{'PkgName': r['package'], 'PkgIdentifier': {'PURL': r['purl']},
                          'VulnerabilityID': r['cve'], 'Severity': 'HIGH'} for r in ASSESSMENT]

    def report(self, *findings):
        return {'Results': [{'Type': 'debian', 'Vulnerabilities': list(findings)}]}

    def test_thirteen_reviewed_findings_only(self):
        result = module.audit(self.report(*self.findings), self.report(), self.allowed)
        self.assertEqual(result['reviewed_system_high'], 13)

    def test_other_findings_must_remain(self):
        for update in ({'PkgName': 'openssh-server'}, {'Severity': 'CRITICAL'},
                       {'VulnerabilityID': 'CVE-2026-106583'},
                       {'PkgIdentifier': {'PURL': 'pkg:deb/debian/gpg@new-version'}}):
            with self.subTest(update=update):
                other = {**self.findings[0], **update}
                before = self.report(*self.findings, other)
                module.audit(before, self.report(other), self.allowed)
                with self.assertRaises(ValueError):
                    module.audit(before, self.report(), self.allowed)

    def test_missing_evidence_or_changed_image_fails(self):
        for field, value in [('files_checked', 0), ('excluded_implementations_found', ['/usr/sbin/sshd']),
                             ('gpg_sign_verify_and_git', 'failed'), ('ssh_keys_agent_sign_verify_config', 'failed'),
                             ('installed_packages', {})]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                module.reviewed_keys(VEX, ASSESSMENT, {**self.evidence, field: value})

    def test_unapplied_vex_or_new_findings_fail(self):
        before = self.report(*self.findings)
        with self.assertRaises(ValueError):
            module.audit(before, before, self.allowed)
        with self.assertRaises(ValueError):
            module.audit(before, self.report({'VulnerabilityID': 'new', 'Severity': 'HIGH'}), self.allowed)

    def test_broader_vex_scope_is_rejected(self):
        vex = copy.deepcopy(VEX)
        vex['statements'][0]['products'][0]['@id'] = 'pkg:deb/debian/gpg'
        with self.assertRaises(ValueError):
            module.reviewed_keys(vex, ASSESSMENT, self.evidence)

    def test_missing_scan_fails(self):
        with self.assertRaises(ValueError):
            module.audit({}, {}, self.allowed)


if __name__ == '__main__':
    unittest.main()
