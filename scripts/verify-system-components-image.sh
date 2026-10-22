#!/usr/bin/env bash
set -Eeuo pipefail
image_ref="${1:?Usage: verify-system-components-image.sh <image-ref>}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
docker run --rm --interactive --entrypoint python3 "${image_ref}" \
  - < "${script_dir}/verify-system-components.py"
