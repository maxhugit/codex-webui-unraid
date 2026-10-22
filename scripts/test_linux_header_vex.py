"""Regression checks against accidentally broadening security exclusions."""

import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("audit", ROOT / "scripts/audit-linux-header-vex.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
VEX = json.loads((ROOT / "security/linux-libc-dev.openvex.json").read_text())


class ApplicabilityTests(unittest.TestCase):
    def setUp(self):
        self.finding = {
            "PkgName": "linux-libc-dev",
            "PkgIdentifier": {"PURL": VEX["statements"][0]["products"][0]["@id"]},
            "VulnerabilityID": VEX["statements"][0]["vulnerability"]["name"],
            "Severity": "HIGH",
        }

    def report(self, *findings):
        return {"Results": [{"Type": "debian", "Vulnerabilities": list(findings)}]}

    def test_reviewed_high_is_removed(self):
        result = module.audit(self.report(self.finding), self.report(), VEX)
        self.assertEqual(result["reviewed_header_high"], 1)

    def test_other_package_new_version_unknown_cve_and_critical_cannot_be_removed(self):
        for field, value in (
            ("PkgName", "linux-image-amd64"),
            ("PkgIdentifier", {"PURL": "pkg:deb/debian/linux-libc-dev@6.12.114-1"}),
            ("VulnerabilityID", "CVE-2099-12345"),
            ("Severity", "CRITICAL"),
        ):
            with self.subTest(field=field):
                other = {**self.finding, field: value}
                with self.assertRaises(ValueError):
                    module.audit(self.report(other), self.report(), VEX)
                module.audit(self.report(other), self.report(other), VEX)

    def test_only_the_reviewed_finding_changes_in_a_mixed_report(self):
        critical = {**self.finding, "Severity": "CRITICAL"}
        unknown = {**self.finding, "VulnerabilityID": "CVE-2099-12345"}
        result = module.audit(
            self.report(self.finding, critical, unknown), self.report(critical, unknown), VEX
        )
        self.assertEqual(result, {"raw_high": 2, "actionable_high": 1, "reviewed_header_high": 1, "critical": 1})

    def test_missing_scan_results_fail(self):
        with self.assertRaises(ValueError):
            module.audit({}, {}, VEX)

    def test_unapplied_vex_fails(self):
        with self.assertRaises(ValueError):
            module.audit(self.report(self.finding), self.report(self.finding), VEX)

    def test_broadening_vex_package_scope_fails(self):
        vex = copy.deepcopy(VEX)
        vex["statements"][0]["products"][0]["@id"] = "pkg:deb/debian/linux-libc-dev"
        with self.assertRaises(ValueError):
            module.audit(self.report(), self.report(), vex)

    def test_review_contains_exactly_67_distinct_high_cves(self):
        self.assertEqual(len(VEX["statements"]), 67)
        self.assertEqual(len({s["vulnerability"]["name"] for s in VEX["statements"]}), 67)
        self.assertNotIn("CVE-2026-93221", {s["vulnerability"]["name"] for s in VEX["statements"]})


if __name__ == "__main__":
    unittest.main()
