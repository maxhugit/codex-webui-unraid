"""Exercise network migration with a fake Docker CLI; never contacts a daemon."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
PAIRS = {
    "mergeron": "codex-webui",
    "mergeron-ingress": "codex-web-ingress",
    "mergeron-squid": "codex-web-squid",
}
FAKE_DOCKER = '''#!/bin/sh
if [ "$1 $2" = "container inspect" ]; then
  if [ "$3" = "--format" ]; then
    [ "$ATTACHED" = yes ] && printf 'yes\\n'
    exit 0
  fi
  case ",$CONTAINERS," in *",$3,"*) exit 0;; *) exit 1;; esac
fi
if [ "$1 $2" = "network inspect" ]; then exit 0; fi
if [ "$1 $2" = "network connect" ]; then
  printf '%s\\n' "$*" >> "$CALLS"
  exit 0
fi
exit 1
'''


class MigrationTests(unittest.TestCase):
    def reconcile(self, containers, attached=False):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            docker = path / "docker"
            docker.write_text(FAKE_DOCKER)
            docker.chmod(0o755)
            calls = path / "calls"
            result = subprocess.run(
                ["sh", str(ROOT / "deployment/docker-man/reconcile-networks.sh"), "once"],
                env={**os.environ, "PATH": f"{directory}:{os.environ['PATH']}",
                     "CONTAINERS": ",".join(containers), "CALLS": str(calls),
                     "ATTACHED": "yes" if attached else "no"},
                capture_output=True, text=True, check=True,
            )
            return calls.read_text().splitlines() if calls.exists() else [], result.stdout

    def test_new_names_keep_legacy_dns_on_all_required_networks(self):
        calls, _ = self.reconcile(PAIRS)
        self.assertEqual(len(calls), 6)
        self.assertIn("network connect --alias codex-webui codex_admin mergeron", calls)
        self.assertIn("network connect --alias codex-web-ingress net_standard mergeron-ingress", calls)
        self.assertIn("network connect --alias codex-web-squid codex_external mergeron-squid", calls)

    def test_existing_installation_still_reconciles(self):
        calls, _ = self.reconcile(PAIRS.values())
        self.assertEqual(len(calls), 6)
        self.assertIn("network connect --alias codex-webui codex_admin codex-webui", calls)

    def test_mixed_names_and_idempotent_connected_networks(self):
        calls, _ = self.reconcile(["mergeron", "codex-web-ingress", "mergeron-squid"])
        self.assertEqual(len(calls), 6)
        calls, _ = self.reconcile(PAIRS, attached=True)
        self.assertEqual(calls, [])

    def test_templates_keep_primary_network_aliases_and_existing_state(self):
        for name, legacy in PAIRS.items():
            root = ET.parse(ROOT / f"deployment/docker-man/my-{name}.xml").getroot()
            self.assertEqual(root.findtext("Name"), name)
            self.assertIn(f"--network-alias={legacy}", root.findtext("ExtraParams"))
            if name == "mergeron":
                self.assertEqual(root.findtext("Repository"), "ghcr.io/maxhugit/mergeron:latest")
                configs = {entry.attrib['Target']: entry.text for entry in root.findall('Config')}
                self.assertEqual(configs['/home/codex'], '/mnt/pool/appdata/codex-web/state/home')
                self.assertEqual(configs['WEBUI_DB_PATH'], '/home/codex/.codex/codex-webui.sqlite')


if __name__ == "__main__":
    unittest.main()
