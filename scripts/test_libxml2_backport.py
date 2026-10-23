import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('xml_audit', ROOT / 'scripts/audit-libxml2-backport.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class XMLBackportTests(unittest.TestCase):
    def setUp(self):
        self.evidence = dict(package_version=module.VERSION, production_uid=11002,
            lxml_runtime_libxml2=[2,9,14], lxml_system_linkage=['/usr/lib/libxml2.so.2'],
            office_xml_consumers=['libxsltfilterlo.so'], conversions=[{}]*18,
            pdf_text_pages_images='passed', word_styles_tables_unicode_roundtrip='passed',
            calc_formula_cached_value=42, slides_unicode_roundtrip='passed',
            malformed_xml_rejected=True, native_python_bindings_installed=False,
            source_review=dict(patches=module.PATCHES, uri_overflow_guard_preexisting=True,
                upstream_regressions='passed', focused_xml_regressions='passed', exported_symbols_check='passed'))
        self.finding = dict(PkgName='libxml2', InstalledVersion=module.VERSION,
                            VulnerabilityID='CVE-2026-6653', Severity='CRITICAL')
        package = dict(Name='libxml2',Version='2.12.7+dfsg+really2.9.14',Release='2.1+deb13u3+webui1',
                       Arch='amd64',SrcName='libxml2',SrcVersion='2.12.7+dfsg+really2.9.14',SrcRelease='2.1+deb13u3+webui1')
        self.report = {'Results':[{'Type':'debian','Packages':[package],'Vulnerabilities':[self.finding]}]}

    def test_corrected_package_does_not_hide_raw_critical(self):
        original=copy.deepcopy(self.report)
        result=module.audit(self.report,self.evidence)
        self.assertEqual(result['raw_findings_retained'][0]['Severity'],'CRITICAL')
        self.assertEqual(self.report,original)

    def test_unknown_cve_wrong_version_or_new_vendor_fix_fails(self):
        for change in ({'VulnerabilityID':'CVE-2099-12345'},{'InstalledVersion':'old'},{'FixedVersion':'new'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.report['Results'][0]['Vulnerabilities']=[{**self.finding,**change}]
                module.audit(self.report,self.evidence)

    def test_conversion_xml_or_formula_failure_blocks(self):
        for change in ({'calc_formula_cached_value':0},{'malformed_xml_rejected':False},
                       {'conversions':[]},{'lxml_system_linkage':[]},{'production_uid':0},{'source_review':{}}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                module.audit(self.report,{**self.evidence,**change})

    def test_old_binary_source_fails(self):
        self.report['Results'][0]['Packages'][0]['SrcRelease']='old'
        with self.assertRaises(ValueError):module.audit(self.report,self.evidence)

    def test_missing_inventory_fails(self):
        with self.assertRaises(ValueError):module.audit({},self.evidence)


if __name__=='__main__': unittest.main()
