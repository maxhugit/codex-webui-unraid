#!/usr/bin/env bash
set -euo pipefail
image=${1:?Application image required}
volume_name="mergeron-home-smoke-${GITHUB_RUN_ID:-local}-$$"
docker volume create --label io.mergeron.test=prepopulated-home "$volume_name" >/dev/null
trap 'docker volume rm "$volume_name" >/dev/null' EXIT
docker run --rm --network none --mount "type=volume,src=$volume_name,dst=/home/codex" --entrypoint /bin/bash "$image" -euc '
  printf "existing project data\n" > /home/codex/before-install.txt
  mkdir -p /home/codex/.codex
  chmod 700 /home/codex/.codex
  printf "# Existing configuration - keep unchanged\n" > /home/codex/.codex/config.toml
  chmod 600 /home/codex/.codex/config.toml
  sha256sum /home/codex/before-install.txt /home/codex/.codex/config.toml > /home/codex/preservation.sha256
'
for attempt in 1 2; do
  docker run --rm --network none --mount "type=volume,src=$volume_name,dst=/home/codex" "$image" /bin/bash -euc '
    node --version
    sha256sum -c /home/codex/preservation.sha256
    test "$(stat -c %a /home/codex/.codex/config.toml)" = 600
    test "$(stat -c %a /home/codex/.codex)" = 700
    test -e /home/codex/.codex-webui-initialized
  '
done
echo 'Pre-populated home bootstraps twice without replacing existing user files.'
