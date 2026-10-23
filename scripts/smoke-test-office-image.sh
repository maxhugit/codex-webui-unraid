#!/usr/bin/env bash
set -Eeuo pipefail
image_ref="${1:?Usage: smoke-test-office-image.sh <image-ref>}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
docker run --rm --interactive --network none \
  --entrypoint /opt/office-venv/bin/python "${image_ref}" \
  - < "${script_dir}/smoke-test-office-conversions.py"
