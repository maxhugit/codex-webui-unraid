#!/usr/bin/env bash
set -Eeuo pipefail

image="${1:?image reference is required}"
expected_version="${2:?expected version is required}"
expected_revision="${3:?expected revision is required}"
expected_created="${4:?expected build date is required}"
expected_channel="${5:?expected release channel is required}"

docker pull "${image}" >/dev/null

for pair in \
  "org.opencontainers.image.version=${expected_version}" \
  "org.opencontainers.image.revision=${expected_revision}" \
  "org.opencontainers.image.created=${expected_created}"; do
  key="${pair%%=*}"
  expected="${pair#*=}"
  actual="$(docker image inspect --format "{{ index .Config.Labels \"${key}\" }}" "${image}")"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "Image label ${key} is ${actual}, expected ${expected}." >&2
    exit 1
  fi
done

build_info="$(docker run --rm --entrypoint cat "${image}" /app/build-info.json)"
jq -e \
  --arg version "${expected_version}" \
  --arg revision "${expected_revision}" \
  --arg builtAt "${expected_created}" \
  --arg channel "${expected_channel}" \
  '. == {version: $version, revision: $revision, builtAt: $builtAt, channel: $channel}' \
  <<<"${build_info}" >/dev/null

echo "Verified Mergeron ${expected_version} (${expected_channel}) build metadata."
