"""Check gh's API, pagination and jq behavior without contacting GitHub."""

import json
import os
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit


class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlsplit(self.path)
        page = parse_qs(url.query).get("page", [""])[0]
        if url.path != "/packages" or page not in ("1", "2"):
            self.send_error(404)
            return
        page = int(page)
        payload = json.dumps([{"id": page, "name": f"package-{page}"}]).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        if page == 1:
            port = self.server.server_address[1]
            self.send_header(
                "Link", f'<http://127.0.0.1:{port}/packages?page=2>; rel="next"'
            )
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


def main():
    with tempfile.TemporaryDirectory(prefix="gh-smoke-") as home:
        # Isolate credentials, config and extensions from the user's persistent home.
        env = {
            "PATH": os.environ["PATH"],
            "HOME": home,
            "GH_CONFIG_DIR": home,
            "GH_TOKEN": "local-fixture-only",
            "GH_PROMPT_DISABLED": "1",
            "GH_NO_UPDATE_NOTIFIER": "1",
            "NO_PROXY": "127.0.0.1",
        }

        def gh(*args):
            return subprocess.run(
                ["gh", *args],
                env=env,
                check=True,
                capture_output=True,
                text=True,
                timeout=15,
            ).stdout

        print(gh("version").splitlines()[0])
        for command in ("auth", "repo", "pr", "api"):
            gh(command, "--help")

        with ThreadingHTTPServer(("127.0.0.1", 0), Fixture) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                endpoint = f"http://127.0.0.1:{server.server_address[1]}/packages?page=1"
                result = gh("api", "--paginate", "--slurp", endpoint)
                expected = [
                    [{"id": 1, "name": "package-1"}],
                    [{"id": 2, "name": "package-2"}],
                ]
                if json.loads(result) != expected:
                    raise RuntimeError(f"Unexpected paginated API output: {result}")
                filtered = gh(
                    "api", "--paginate", endpoint,
                    "--jq", ".[].id",
                )
                if filtered.splitlines() != ["1", "2"]:
                    raise RuntimeError(f"Unexpected jq output: {filtered}")
            finally:
                server.shutdown()
                thread.join(timeout=5)
        print("GitHub CLI API, pagination, slurp and jq checks passed.")


if __name__ == "__main__":
    main()
