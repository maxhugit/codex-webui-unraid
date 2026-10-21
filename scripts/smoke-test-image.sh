#!/usr/bin/env bash
set -Eeuo pipefail

image_ref="${1:?Usage: smoke-test-image.sh <image-ref>}"
container_name="codex-webui-smoke-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"

cleanup() {
  docker rm --force "${container_name}" >/dev/null 2>&1 || true
}

show_failure() {
  echo "Candidate container did not become healthy." >&2
  docker inspect "${container_name}" >&2 || true
  docker logs "${container_name}" >&2 || true
}

trap cleanup EXIT

docker run --detach \
  --name "${container_name}" \
  --env NODE_ENV=production \
  --env PORT=8172 \
  --env WEBUI_API_KEY=github-actions-smoke-test \
  --env WEBUI_DB_PATH=/tmp/codex-webui-smoke.sqlite \
  "${image_ref}" >/dev/null

for _ in $(seq 1 60); do
  state="$(docker inspect --format '{{.State.Status}}' "${container_name}")"
  health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "${container_name}")"

  if [[ "${health}" == "healthy" ]]; then
    echo "Candidate container is healthy."
    exit 0
  fi

  if [[ "${state}" == "exited" || "${state}" == "dead" ]]; then
    show_failure
    exit 1
  fi

  sleep 2
done

show_failure
exit 1
