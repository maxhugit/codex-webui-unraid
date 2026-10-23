# libxml2 security backport and Office conversions

## Scope and applicability (2026-10-23)

Debian Trixie's version `2.12.7+dfsg+really2.9.14-2.1+deb13u3` contains 2.9.14
code. Replacing it with a current ABI-breaking libxml2 release would require
rebuilding its consumers. This change instead rebuilds the exact Debian source
with seven unchanged Ubuntu noble-security stable backports from
`2.9.14+dfsg-1.3ubuntu3.10`. This is a project-maintained Debian rebuild, not an
official Trixie security update; future security fixes require maintenance.

| Finding | Actual implementation and exposure | Change |
| --- | --- | --- |
| CVE-2026-6653 (CRITICAL) | Entity-handling UAF in the shipped native parser; relevant when processing crafted XML/DTD entities | Apply stable entity-amplification rework |
| CVE-2026-86138 (HIGH) | Native dictionary QName pool allocation overflow; affected code present, extreme lengths required | Apply stable arithmetic guards |
| CVE-2026-86140 (HIGH) | Native DTD validation error formatting; affected code present | Apply stable buffer bounds checks |
| CVE-2026-86142 (HIGH) | Native XPointer expression length overflow; code present, oversized expressions required | Apply stable length guard |
| CVE-2026-86143 (HIGH) | Native XML output callback length overflow; code present, >= INT_MAX buffer required | Apply stable callback guards |
| CVE-2026-86144 (HIGH) | XInclude APIs lose parsing flags, including NONET; code present, only applicable when those APIs are invoked | Apply stable flag propagation |
| CVE-2026-74860 (HIGH) | Legacy Python libxml2 SAX bindings, not lxml; python3-libxml2 is not shipped | Apply its source fix too; keep bindings out of production |
| CVE-2026-86139 (HIGH) | Upstream URI escape overflow pattern is already guarded by `if (!(len > 0)) return(NULL)` in this Debian code | Verify the existing guard; do not claim a newly applied fix |

The native library and affected APIs are present in the image, and Office modules
link to it. This review does not establish that every individual API is reachable
through every Office file importer, or claim a demonstrated remote exploit.
Absence of a demonstrated path is not used to suppress an alert. All findings
remain visible in raw and final Trivy reports, including the CRITICAL.

The Office lxml wheel can bundle a separate native XML library that Trivy's Python
package scan does not fully inventory. lxml is therefore rebuilt from its pinned
6.1.3 source against the patched system headers and shared library. Runtime checks
verify that it actually loads the same system libxml2 instead of a bundled copy.

## Provenance and compatibility checks

`scripts/build-libxml2-backport.sh` pins SHA-256 for Debian's descriptor, original
source and patch archive, plus Ubuntu's descriptor and stable patch archive.
Every committed patch is checked byte-for-byte against the Ubuntu archive and its
manifest digest. Patches apply without fuzz; no Ubuntu binary or repository is
installed. The existing Debian patch set is retained. The regression corpus omitted by the
Debian archive is restored only in the builder from the SHA-256-pinned official
GNOME 2.9.14 release; its code does not replace Debian code.

Debian's exported-symbol check remains enabled and SONAME `libxml2.so.2` is kept.
The stable entity fix appends fields to public internal-facing structures, as in
the Ubuntu 2.9.14 security update; keeping the SONAME and symbols alone does not
prove universal ABI compatibility. Real Office roundtrips and XML tests supply
additional evidence for the consumers shipped here. Consumers that allocate such
structures themselves outside the tested paths are not exhaustively covered.

Upstream tests (`runtests`) and focused native tests cover entity processing,
dictionaries, URI escaping, XPointer, output callbacks and XInclude NONET
propagation through both document/tree APIs and text/XML includes. The focused
XInclude regression uses a local loader that fails if the security flag is lost;
it never makes network requests. Tests do not allocate multi-gigabyte buffers to
exercise the integer-overflow thresholds. Source/patch verification covers those
guards instead.

## Office validation

The final image runs tests as UID 11002 with networking disabled and fresh
LibreOffice profiles. Synthetic Word, Calc and Impress documents contain Unicode,
images, tables and a real spreadsheet formula. Eighteen conversions cover:
DOCX/ODT/DOC, XLSX/ODS/XLS, PPTX/ODP/PPT, with PDF export and modern-format
roundtrips. PDF page counts, extracted text and embedded images are checked.
Word table/style/Unicode content, formula preservation and cached value 42, and
slide content survive roundtrip. Strict lxml parsing must reject malformed XML;
LibreOffice may intentionally import an unknown XML file as plain text, so PDF
creation alone is not used as a rejection/security assertion.
These are functional/content checks, not exhaustive visual layout certification.

Both PR and publication workflows retain Office evidence. The gate checks exact
binary/source versions, reviewed patch digests, actual lxml linkage and conversion
results. Known source-fixed/preexisting/non-shipped findings with missing Debian
FixedVersion metadata stay in the reports. Unknown CVEs, changed versions or new
vendor fixed-version metadata stop the review. No libxml2 VEX or Trivy ignore is
added. Development headers and legacy Python bindings stay out of the final image.

The publication workflow also runs its existing SSH test before consuming
`ssh-client-evidence.json`, correcting the producer/consumer ordering separately
tracked in PR #65.

Sources:
- https://security-tracker.debian.org/tracker/source-package/libxml2
- https://security.ubuntu.com/ubuntu/pool/main/libx/libxml2/libxml2_2.9.14+dfsg-1.3ubuntu3.10.dsc
- https://ubuntu.com/security/CVE-2026-6653
- https://security-tracker.debian.org/tracker/CVE-2026-86139
- Upstream fix commit IDs and stable-patch digests: `libxml2-patches/manifest.json`.
