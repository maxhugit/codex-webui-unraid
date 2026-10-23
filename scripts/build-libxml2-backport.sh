#!/usr/bin/env bash
set -Eeuo pipefail
cd /build
fetch() {
  local url="$1" file="$2" digest="$3"
  curl --fail --silent --show-error --location --retry 3 "$url" --output "$file"
  echo "${digest}  ${file}" | sha256sum --check --strict
}
base=https://deb.debian.org/debian/pool/main/libx/libxml2
fetch "$base/libxml2_2.12.7+dfsg+really2.9.14-2.1+deb13u3.dsc" libxml2.dsc 04b1da890535b11e3db231f39114ee09e643badceff79441d749d0ca78efaaa5
fetch "$base/libxml2_2.12.7+dfsg+really2.9.14.orig.tar.xz" libxml2_2.12.7+dfsg+really2.9.14.orig.tar.xz 4fe913dec8b1ab89d13b489b419a8203176ea39e931eaa0d25b17eafb9c279e9
fetch "$base/libxml2_2.12.7+dfsg+really2.9.14-2.1+deb13u3.debian.tar.xz" libxml2_2.12.7+dfsg+really2.9.14-2.1+deb13u3.debian.tar.xz 3b6d265f482d6a8fbe3c056d2006fb3b563b4a838f7258b388ac5f0b29206921
base=https://security.ubuntu.com/ubuntu/pool/main/libx/libxml2
fetch "$base/libxml2_2.9.14+dfsg-1.3ubuntu3.10.dsc" ubuntu.dsc 1e2a56b4ae292abd2715b1f411cfa30f1b31ef9013c60d2f906d4a68b165cd4c
fetch "$base/libxml2_2.9.14+dfsg-1.3ubuntu3.10.debian.tar.xz" ubuntu.debian.tar.xz d2d821830eb60edbcfcbe30e2827420e9e439e98c85c812352969cdda764d60b
# Debian's DFSG archive omits the regression corpus. Restore only test data from
# the matching official upstream release; no upstream code replaces Debian code.
fetch https://download.gnome.org/sources/libxml2/2.9/libxml2-2.9.14.tar.xz upstream-tests.tar.xz 60d74a257d1ccec0475e749cba2f21559e48139efba6ff28224357c7c798dfee
# Verify each reviewed patch is byte-for-byte the maintained stable backport.
python3 - <<'PY'
import hashlib,json,tarfile
from pathlib import Path
manifest=json.loads(Path('/reviewed-patches/manifest.json').read_text())
with tarfile.open('ubuntu.debian.tar.xz') as archive:
    for row in manifest:
        data=Path('/reviewed-patches', row['file']).read_bytes()
        assert hashlib.sha256(data).hexdigest()==row['sha256']
        assert data==archive.extractfile('debian/patches/'+row['file']).read()
PY
dpkg-source --no-check -x libxml2.dsc libxml2
cd libxml2
mkdir -p /tmp/xml-test-corpus
tar -xJf ../upstream-tests.tar.xz -C /tmp/xml-test-corpus libxml2-2.9.14/test libxml2-2.9.14/result
cp -a /tmp/xml-test-corpus/libxml2-2.9.14/test /tmp/xml-test-corpus/libxml2-2.9.14/result .
for patch in /reviewed-patches/*.patch; do
  cp "$patch" debian/patches/
  basename "$patch" >> debian/patches/series
done
QUILT_PATCHES=debian/patches QUILT_PATCH_OPTS='--fuzz=0' quilt push -a
# The URI guard is already present in Debian's 2.9.14 code; do not claim a new fix.
python3 - <<'PY'
from pathlib import Path
s=Path('uri.c').read_text();s=s[s.index('xmlURIEscapeStr(const'):]
assert 'len = xmlStrlen(str);\n    if (!(len > 0)) return(NULL);' in s
PY
cp debian/changelog /tmp/libxml2-changelog.original
{
  printf 'libxml2 (2.12.7+dfsg+really2.9.14-2.1+deb13u3+webui1) trixie; urgency=high\n\n'
  printf '  * Apply reviewed Ubuntu stable 2.9.14 security backports; keep SONAME 2.\n\n'
  printf ' -- WebUI maintainers <webui@example.invalid>  Fri, 23 Oct 2026 10:00:00 +0200\n\n'
  cat /tmp/libxml2-changelog.original
} > debian/changelog
# Build the actual Debian runtime/dev packages with the existing exported-symbol
# check enabled. Python libxml2 bindings are not shipped by the production image.
dpkg-buildpackage --build=any --no-sign -Pnopython -j2
# Debian's packaging does not run these upstream tests by default.
make -C builddir/main -j2 runtests
mkdir -p /out
cp ../libxml2_*_amd64.deb ../libxml2-dev_*_amd64.deb /out/
cp ../libxml2.dsc ../ubuntu.dsc /reviewed-patches/manifest.json /out/
gcc -Wall -Werror -Ibuilddir/main/include -Iinclude /tmp/smoke-test-libxml2.c \
  -Lbuilddir/main/.libs -lxml2 -o /out/libxml2-regressions
LD_LIBRARY_PATH="$PWD/builddir/main/.libs" /out/libxml2-regressions
python3 - <<'PY'
import json
from pathlib import Path
patches=json.loads(Path('/reviewed-patches/manifest.json').read_text())
Path('/out/source-review.json').write_text(json.dumps({
    'debian_base': '2.12.7+dfsg+really2.9.14-2.1+deb13u3',
    'patches': patches, 'uri_overflow_guard_preexisting': True,
    'upstream_regressions': 'passed', 'focused_xml_regressions': 'passed',
    'exported_symbols_check': 'passed', 'soname': 'libxml2.so.2',
    'native_python_bindings': 'not built (nopython profile)'
}, indent=2)+'\n')
PY
