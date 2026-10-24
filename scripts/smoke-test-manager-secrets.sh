#!/usr/bin/env bash
set -euo pipefail
image=${1:?Manager image required}
fixture_dir=$(mktemp -d /tmp/mergeron-manager-secret.XXXXXXXX)
trap 'rm -f "$fixture_dir/token"; rmdir "$fixture_dir"' EXIT
chmod 755 "$fixture_dir"
printf 'private-test-token\n' > "$fixture_dir/token"
chmod 600 "$fixture_dir/token"
if [ "$(id -u)" = 0 ]; then chown 11002:11002 "$fixture_dir/token"; else sudo chown 11002:11002 "$fixture_dir/token"; fi
before=$(stat -c '%u:%g:%a' "$fixture_dir/token")
read_test='const fs=require("node:fs"); if(fs.readFileSync("/host-state/token","utf8")!=="private-test-token\n")process.exit(1);'
if docker run --rm --network none --read-only --cap-drop ALL --cap-add CHOWN --security-opt no-new-privileges:true -v "$fixture_dir:/host-state:ro" --entrypoint /nodejs/bin/node "$image" -e "$read_test" >/dev/null 2>&1; then
  echo 'Secret unexpectedly readable without DAC_READ_SEARCH' >&2
  exit 1
fi
docker run --rm --network none --read-only --cap-drop ALL --cap-add CHOWN --cap-add DAC_READ_SEARCH --security-opt no-new-privileges:true -v "$fixture_dir:/host-state:ro" --entrypoint /nodejs/bin/node "$image" -e "$read_test"
test "$(stat -c '%u:%g:%a' "$fixture_dir/token")" = "$before"
echo 'Manager can read UID 11002 mode-0600 secrets without changing permissions or content.'
