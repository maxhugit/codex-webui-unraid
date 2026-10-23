import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('ssh_audit', ROOT / 'scripts/audit-openssh-backport.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SSHBackportTests(unittest.TestCase):
    def setUp(self):
        self.evidence = {'packages': dict.fromkeys(module.PACKAGES, module.VERSION),
                         'ssh_version': 'OpenSSH_10.6p1 Debian-gssapi-test', 'production_uid': 11002,
                         'gssapi_options': 'passed; no Kerberos realm exercised',
                         **dict.fromkeys(module.CHECKS, 'passed')}
        packages = [{'Name': name, 'Version': '10.6p1', 'Release': '1~webui13.1', 'Epoch': 1,
                     'Arch': 'amd64', 'SrcName': source, 'SrcVersion': '10.6p1',
                     'SrcRelease': '1~webui13.1', 'SrcEpoch': 1} for name, source in module.PACKAGES.items()]
        self.finding = {'PkgName': 'openssh-common', 'InstalledVersion': module.VERSION,
                        'VulnerabilityID': 'CVE-2026-60002', 'Severity': 'CRITICAL'}
        self.report = {'Results': [{'Type': 'debian', 'Packages': packages,
                                    'Vulnerabilities': [self.finding]}]}

    def test_known_fixed_source_is_accepted_without_removing_critical(self):
        original = copy.deepcopy(self.report)
        result = module.audit(self.report, self.evidence)
        self.assertEqual(result['raw_findings_retained'][0]['Severity'], 'CRITICAL')
        self.assertEqual(self.report, original)

    def test_unknown_cve_wrong_version_or_new_vendor_metadata_fails(self):
        for update in ({'VulnerabilityID': 'CVE-2099-12345'}, {'InstalledVersion': '1:10.0p1'},
                       {'FixedVersion': '1:10.7p1-1'}):
            with self.subTest(update=update), self.assertRaises(ValueError):
                self.report['Results'][0]['Vulnerabilities'] = [{**self.finding, **update}]
                module.audit(self.report, self.evidence)

    def test_missing_tests_or_wrong_user_fail(self):
        for update in ({'ssh_command': 'failed'}, {'strict_host_key_rejection': 'failed'},
                       {'production_uid': 0}, {'packages': {}}):
            with self.subTest(update=update), self.assertRaises(ValueError):
                module.audit(self.report, {**self.evidence, **update})

    def test_old_source_or_extra_package_fails(self):
        self.report['Results'][0]['Packages'][0]['SrcVersion'] = '10.0p1'
        with self.assertRaises(ValueError):
            module.audit(self.report, self.evidence)

    def test_missing_inventory_fails(self):
        with self.assertRaises(ValueError):
            module.audit({}, self.evidence)


if __name__ == '__main__':
    unittest.main()
