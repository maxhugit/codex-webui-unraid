#!/bin/sh
set -eu

if [ "${1:-}" = "healthcheck" ]; then
  token="$(cat /run/secrets/backend_token)"
  exec curl -fsS -H "Authorization: Bearer $token" \
    http://127.0.0.1:8172/api/status
fi

WEBUI_API_KEY="$(cat /run/secrets/backend_token)"
export WEBUI_API_KEY

exec /usr/local/bin/entrypoint.sh node /app/dist/main.js
