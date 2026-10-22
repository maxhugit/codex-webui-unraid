#!/usr/bin/env bash
set -Eeuo pipefail

owner="${GHCR_OWNER:?GHCR_OWNER is required}"
package="${GHCR_PACKAGE:?GHCR_PACKAGE is required}"
keep="${KEEP_SHA_VERSIONS:-10}"
dry_run="${DRY_RUN:-false}"

if ! [[ "${keep}" =~ ^[0-9]+$ ]]; then
  echo "KEEP_SHA_VERSIONS must be a non-negative integer." >&2
  exit 1
fi

endpoint="/users/${owner}/packages/container/${package}/versions"
versions="$(gh api --paginate --slurp "${endpoint}?per_page=100")"

# Only delete versions whose complete tag set consists of sha-* tags. Images
# carrying latest, buildcache or a future release tag are always protected.
candidates=()
while IFS= read -r candidate; do
  candidates+=("${candidate}")
done < <(
  jq -r --argjson keep "${keep}" '
    [
      add[]
      | select((.metadata.container.tags | length) > 0)
      | select(all(.metadata.container.tags[]; startswith("sha-")))
    ]
    | sort_by(.created_at)
    | reverse
    | .[$keep:]
    | .[]
    | [.id, .created_at, (.metadata.container.tags | join(","))]
    | @tsv
  ' <<<"${versions}"
)

if (( ${#candidates[@]} == 0 )); then
  echo "No SHA-only image exceeds the ${keep}-version retention limit."
  exit 0
fi

for candidate in "${candidates[@]}"; do
  IFS=$'\t' read -r version_id created_at tags <<<"${candidate}"
  if [[ "${dry_run}" == "true" ]]; then
    echo "Would delete ${tags} (${created_at}, version ${version_id})."
    continue
  fi

  echo "Deleting ${tags} (${created_at}, version ${version_id})."
  gh api --method DELETE "${endpoint}/${version_id}"
done

if [[ "${dry_run}" == "true" ]]; then
  echo "Dry run complete; no package version was deleted."
else
  echo "GHCR SHA retention cleanup complete."
fi
