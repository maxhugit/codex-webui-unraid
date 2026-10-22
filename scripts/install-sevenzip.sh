#!/usr/bin/env bash
set -Eeuo pipefail
version="${1:?Usage: install-sevenzip.sh <version> <sha256> <directory>}"
checksum="${2:?Missing checksum}"
destination="${3:?Missing destination}"
[[ "${version}" =~ ^[0-9]+\.[0-9]+$ && "${checksum}" =~ ^[a-f0-9]{64}$ ]]
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]]
archive="$(mktemp)"
trap 'rm -f "${archive}"' EXIT
curl --fail --silent --show-error --location \
  "https://github.com/ip7z/7zip/releases/download/${version}/7z${version//./}-linux-x64.tar.xz" \
  --output "${archive}"
echo "${checksum}  ${archive}" | sha256sum --check --strict
mkdir -p "${destination}"
tar -xJf "${archive}" -C "${destination}" 7zz License.txt History.txt readme.txt
for command in 7z 7za 7zr; do ln -sfn 7zz "${destination}/${command}"; done
"${destination}/7za" i | grep -F "7-Zip (z) ${version}"
