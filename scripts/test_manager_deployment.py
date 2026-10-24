from pathlib import Path
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]


class ManagerDeploymentTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.compose = (ROOT / "deployment/compose.unraid.yml").read_text()
        cls.production_env = (ROOT / "deployment/.env.example").read_text()
        cls.development_env = (ROOT / "deployment/.env.dev.example").read_text()
        cls.workflow = (ROOT / ".github/workflows/docker-publish.yml").read_text()

    def test_compose_manager_is_isolated_and_shares_only_its_unix_socket(self) -> None:
        manager = self.compose.split("  mergeron-manager:", 1)[1]
        self.assertIn("network_mode: none", manager)
        self.assertIn("/var/run/docker.sock:/var/run/docker.sock:ro", manager)
        self.assertIn("${STATE_ROOT}/manager-run:/run/mergeron-manager", manager)
        application = self.compose.split("  mergeron-ui:", 1)[1].split(
            "  mergeron-ingress:", 1
        )[0]
        self.assertIn("${STATE_ROOT}/manager-run:/run/mergeron-manager", application)

    def test_dockerman_manager_has_no_network_or_published_port(self) -> None:
        root = ET.parse(
            ROOT / "deployment/docker-man/my-mergeron-manager.xml"
        ).getroot()
        self.assertEqual(root.findtext("Network"), "none")
        self.assertIsNone(root.find("Config[@Type='Port']"))
        self.assertEqual(
            root.find("Config[@Target='/var/run/docker.sock']").attrib["Mode"],
            "ro",
        )

    def test_development_profile_cannot_reuse_production_identity(self) -> None:
        self.assertIn("STATE_ROOT=/mnt/pool/appdata/mergeron/state", self.production_env)
        self.assertIn(
            "STATE_ROOT=/mnt/pool/appdata/mergeron-dev/state", self.development_env
        )
        self.assertIn("MERGERON_STACK_PREFIX=mergeron-dev", self.development_env)
        self.assertIn("MERGERON_ADMIN_SUBNET=172.30.44.16/28", self.development_env)
        self.assertIn(
            "MERGERON_WEBUI_URL=https://mergeron-dev.hugotlab.fr",
            self.development_env,
        )

    def test_workflow_builds_and_promotes_the_manager_by_digest(self) -> None:
        self.assertIn("manager-build:", self.workflow)
        self.assertIn("file: ./Dockerfile.manager", self.workflow)
        self.assertIn("SOURCE_DIGEST: ${{ needs.manager-build.outputs.digest }}", self.workflow)
        self.assertIn("MANAGER_IMAGE_DIGEST", self.workflow)


if __name__ == "__main__":
    unittest.main()
