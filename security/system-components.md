# GnuPG, systemd and SSH server applicability

Review date: 2026-10-22. Scope: exact Debian package versions and architectures in
`system-components-assessment.json`, in the immutable Unraid WebUI image.
This is an applicability assessment, not a binary update or an assessment of the
Unraid host, bind mounts, TPM passthrough or tools subsequently installed by users.

| CVE | HIGH findings | Affected implementation | Image decision |
| --- | ---: | --- | --- |
| CVE-2026-24882 | 7 | GnuPG tpm2daemon TPM private-key decryption | Not present; normal GPG tools retained |
| CVE-2026-16742 | 2 | systemd-homed authentication and systemd-homework | Not present in libsystemd0/libudev1 or elsewhere in image |
| CVE-2026-59999 | 1 | sshd forwarding/tunnelling option handling | No SSH server shipped |
| CVE-2026-60000 | 1 | sshd GSSAPI authentication attempt limit | No SSH server shipped |
| CVE-2026-106553 | 1 | sshd GSSAPI credential persistence | No SSH server shipped |
| CVE-2026-106555 | 1 | sshd GSSAPI authentication state persistence | No SSH server shipped |

Sources, reviewed individually:
- https://security-tracker.debian.org/tracker/CVE-2026-24882
- https://github.com/systemd/systemd/security/advisories/GHSA-jm29-p7hh-vjhv
- https://security-tracker.debian.org/tracker/CVE-2026-59999
- https://security-tracker.debian.org/tracker/CVE-2026-60000
- https://security-tracker.debian.org/tracker/CVE-2026-106553
- https://security-tracker.debian.org/tracker/CVE-2026-106555
- https://www.openssh.org/releasenotes.html#10.4p1
- https://www.openssh.org/releasenotes.html#10.6p1

## Evidence and safeguards

Both PR and publication workflows inspect installed packages and the actual
filesystem under /usr, /opt, /root and /home as root, plus the compressed
toolchain seed restored by the entrypoint. Unreadable directories fail the check. The review fails if tpm2daemon,
systemd-homed, systemd-homework, sshd, sshd-auth or sshd-session appears, including
unpackaged files, or if a reviewed package version changes. Debian's merged /usr
covers /bin, /sbin and /lib. Runtime mounts and user modifications are outside this
immutable-image check. No package is removed and no client configuration changes.

Only after this inventory and the GPG/SSH functional tests succeed is a combined
OpenVEX document generated for Trivy. The audit compares the header-only report to
the final report and permits only the 13 exact HIGH package/CVE/PURL decisions.
Unknown CVEs, other versions/packages, client vulnerabilities and all CRITICAL
findings must remain. Raw, header-only and final JSON reports, the evidence and
all applicability documents are retained as CI artifacts. SARIF uses the same
combined document in the publication workflow.

Functional checks cover GPG key creation, detached signing/verification and signed
Git commit verification; SSH Ed25519 key creation, strict host-key configuration,
agent loading and an agent-backed signature/verification. They run in a disposable
container with temporary keys, without credentials or external network services.
They do not claim to test a remote SSH/SFTP connection. Existing image health,
Office, archive and GitHub CLI tests remain enabled.

## Findings intentionally retained

- CVE-2026-106583: SSH **client** username command injection. The client is shipped;
  this finding is not covered by the server-only assessment.
- CVE-2026-60002 (CRITICAL): SSH **client** host-key re-exchange use-after-free.
  Also retained for a subsequent client remediation.
- All unrelated HIGH and CRITICAL findings, including the existing kernel-header
  CRITICAL. The separate Linux-header assessment is unchanged.

The projected filtered count is 101 to 88 HIGH, with 3 CRITICAL unchanged, if the
vulnerability database and installed packages remain identical. Raw findings are
not patched away by these applicability statements.
