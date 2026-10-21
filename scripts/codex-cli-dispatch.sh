#!/usr/bin/env bash
set -euo pipefail

# One stable entry point for Codex and its argv[0]-dispatched helper tools.
# A WebUI-managed selection wins; an installation left by older images remains
# available as a migration fallback. Fresh installations fail with a precise
# diagnostic until an administrator installs the CLI from the WebUI.
tool="$(basename "$0")"
codex_home="${CODEX_HOME:-${HOME}/.codex}"
selection_file="${codex_home}/webui/cli/selection.json"
selected_version=""

if [ -f "${selection_file}" ]; then
  selected_version="$(jq -r 'if (.version | type) == "string" then .version else "" end' "${selection_file}" 2>/dev/null || true)"
fi

if [[ "${selected_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  selected_binary="${codex_home}/webui/cli/releases/${selected_version}/codex"
  if [ ! -x "${selected_binary}" ]; then
    echo "Codex CLI ${selected_version} is selected but its executable is unavailable." >&2
    exit 127
  fi
  exec -a "${tool}" "${selected_binary}" "$@"
fi

legacy_binary="$(find "${HOME}/.local/share/mise/installs/node" -type f -name codex \
  \( -path '*/vendor/*/bin/codex' -o -path '*/vendor/*/codex/codex' \) \
  2>/dev/null | sort -V | tail -1 || true)"
if [ -n "${legacy_binary}" ]; then
  exec -a "${tool}" "${legacy_binary}" "$@"
fi

echo "Codex CLI is not installed. Open Administration > Codex CLI to install it." >&2
exit 127
