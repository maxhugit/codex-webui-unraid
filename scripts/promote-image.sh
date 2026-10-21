#!/usr/bin/env bash
set -Eeuo pipefail

: "${SOURCE_IMAGE:?SOURCE_IMAGE is required}"
: "${SOURCE_DIGEST:?SOURCE_DIGEST is required}"
: "${TARGET_TAGS:?TARGET_TAGS is required}"

image_repository="${SOURCE_IMAGE%:*}"
source_reference="${image_repository}@${SOURCE_DIGEST}"
declare -a tag_arguments=()

while IFS= read -r tag; do
  [[ -n "${tag}" ]] || continue
  tag_arguments+=(--tag "${tag}")
done <<< "${TARGET_TAGS}"

if [[ ${#tag_arguments[@]} -eq 0 ]]; then
  echo "No target tags were generated." >&2
  exit 1
fi

docker buildx imagetools create "${tag_arguments[@]}" "${source_reference}"

for ((index = 1; index < ${#tag_arguments[@]}; index += 2)); do
  docker buildx imagetools inspect "${tag_arguments[index]}" >/dev/null
done
