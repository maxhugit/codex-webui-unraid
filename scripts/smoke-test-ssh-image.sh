#!/usr/bin/env bash
set -Eeuo pipefail
image_ref="${1:?Usage: smoke-test-ssh-image.sh <production-image> <fixture-image>}"
fixture_image="${2:?Missing SSH fixture image}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
identity="webui-ssh-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
network="${identity}-network"
server="${identity}-server"
client="${identity}-client"
fixtures="$(mktemp -d)"
cleanup() {
  docker rm --force "${server}" "${client}" >/dev/null 2>&1 || true
  docker network rm "${network}" >/dev/null 2>&1 || true
  rm -rf "${fixtures}"
}
trap cleanup EXIT
ssh-keygen -q -t ed25519 -N '' -f "${fixtures}/host-key"
ssh-keygen -q -t ed25519 -N '' -f "${fixtures}/client-key"
printf 'ssh-fixture %s\n' "$(cat "${fixtures}/host-key.pub")" > "${fixtures}/known_hosts"
cat > "${fixtures}/sshd_config" <<'CONFIG'
Port 22
ListenAddress 0.0.0.0
HostKey /fixtures/host-key
AuthorizedKeysFile /fixtures/client-key.pub
StrictModes no
PermitRootLogin prohibit-password
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
Subsystem sftp internal-sftp
LogLevel VERBOSE
CONFIG
chmod 755 "${fixtures}"
cp "${script_dir}/smoke-test-ssh-client.py" "${fixtures}/test.py"
docker network create --internal "${network}" >/dev/null
docker run --detach --name "${server}" --network "${network}" --network-alias ssh-fixture \
  --mount "type=bind,src=${fixtures},dst=/fixtures,readonly" "${fixture_image}" >/dev/null
docker run --detach --name "${client}" --network "${network}" "${image_ref}" sleep infinity >/dev/null
# Copy disposable keys, then test as the real production UID with strict file modes.
docker exec --user 0 "${client}" mkdir -p /tmp/webui-ssh-test
docker cp "${fixtures}/client-key" "${client}:/tmp/webui-ssh-test/client-key"
docker cp "${fixtures}/known_hosts" "${client}:/tmp/webui-ssh-test/known_hosts"
docker cp "${fixtures}/test.py" "${client}:/tmp/webui-ssh-test/test.py"
docker exec --user 0 "${client}" chown -R 11002:11002 /tmp/webui-ssh-test
for _ in $(seq 1 30); do
  if docker logs "${server}" 2>&1 | grep -q 'Server listening'; then break; fi
  if [[ "$(docker inspect --format '{{.State.Running}}' "${server}")" != true ]]; then
    docker logs "${server}" >&2
    exit 1
  fi
  sleep 1
done
if ! docker exec "${client}" python3 /tmp/webui-ssh-test/test.py; then
  docker logs "${server}" >&2
  docker logs "${client}" >&2
  exit 1
fi
