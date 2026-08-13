# ADR 0012: WinRM Transport Library for IT Ops Batch Runs

## Status

Superseded by ADR 0013

## Context

ADR 0011 (IT Ops Module) commits to running Batch Runs against Windows
hosts over three transports: SSH (existing `russh`), PsExec (shipped via
an Install Helper recipe), and **WinRM / WS-Man**. WinRM is the standard,
firewall-friendly path and the one the roadmap names for Windows Update
playbooks, so its library choice needs a decision record like the SSH
transport choice in ADR 0004.

KKTerm's dependency rule (`docs/PRD.md`, ADR 0003) is firm: runtime
dependencies must be MIT / Apache-2.0 / BSD / MPL-style; **GPL is not
allowed in the core runtime**. WinRM also requires SPNEGO/NTLM or Kerberos
authentication, which must work cross-platform (KKTerm targets Windows,
macOS, and Linux) — a Linux/macOS operator driving Windows hosts cannot
rely on Windows-only SSPI APIs.

Survey of the Rust WinRM landscape (June 2026):

| Crate | License | Maturity | Verdict |
| --- | --- | --- | --- |
| `librust-winrm` | **GPL-3.0-or-later** | v0.1.1, ~939 downloads, first published Dec 2025 | Rejected — GPL, immature |
| `rust-winrm-client` | **GPL-3.0-or-later** | v0.1.2, ~74 downloads | Rejected — GPL, immature, CLI-oriented |
| (no other maintained, license-compatible WinRM client crate found) | — | — | — |

There is **no mature, license-compatible turnkey WinRM crate**. Both
existing options are GPL and would contaminate KKTerm's MIT core, and both
are brand-new with negligible adoption.

The building blocks for a thin client, by contrast, are clean and mature:

| Crate | Role | License | Maturity |
| --- | --- | --- | --- |
| `reqwest` | HTTP(S) transport for the WS-Man SOAP endpoint | MIT / Apache-2.0 | ubiquitous |
| `sspi` (sspi-rs, Devolutions) | Cross-platform NTLM + Kerberos/Negotiate in pure Rust | MIT / Apache-2.0 | ~1.1M downloads |
| `quick-xml` | Build/parse the WS-Man SOAP envelopes | MIT | ~300M downloads |

WS-Man remote shell is a small, well-specified set of SOAP actions
(`wsman` Shell `Create` → `Command` → `Receive` (poll) → `Signal` →
`Delete`). It does not require a general SOAP framework.

## Decision

Do **not** take a WinRM crate dependency. Implement a **thin, purpose-built
WinRM/WS-Man client** inside the IT Ops transport layer, built on
`reqwest` + `sspi` + `quick-xml`:

- `reqwest` opens the HTTP(S) connection to the WinRM listener (5985
  HTTP / 5986 HTTPS) and carries the SOAP request/response bodies.
- `sspi` performs the authentication handshake — **NTLM** first (works
  without domain/Kerberos infrastructure, the common admin case), with
  **Negotiate/Kerberos** as a later enhancement. `sspi` keeps this
  cross-platform so a macOS/Linux operator can drive Windows hosts.
- `quick-xml` builds the WS-Man Shell/Command/Receive/Signal/Delete
  envelopes and parses stdout/stderr/exit-code fragments.
- The client implements only the remote-shell command lifecycle IT Ops
  needs (run a command/script, stream output, signal terminate, clean up
  the shell). It is **not** a general WS-Man management library.

Scope guards, consistent with the SSH transport and command-runtime
invariants:

- All WinRM I/O runs in `spawn_blocking`/worker tasks with bounded
  per-host timeouts and reports progress by event — never on the UI
  thread (`docs/ARCHITECTURE.md`).
- WinRM credentials live in the OS keychain under the existing
  secret-owner model (a new secret kind), never in SQLite.
- HTTPS (5986) is preferred; allowing plain HTTP (5985) or skipping
  certificate validation is an explicit, per-Host-Group opt-in surfaced
  in the UI, mirroring the SSH host-key and "insecure TLS" patterns.

## Consequences

- KKTerm keeps a clean MIT core: no GPL dependency, no Windows-only auth
  lock-in. The auth handshake reuses the same `sspi` crate the broader
  ecosystem trusts.
- KKTerm owns a small amount of WS-Man protocol code (envelope
  construction, output framing, fault handling). This is the same
  trade-off ADR 0011 already accepts for PsExec/playbooks: a bounded,
  testable protocol surface instead of a heavy or mis-licensed
  dependency. The envelope set is small and stable, so the maintenance
  cost is low and unit-testable against captured fixtures.
- Kerberos/Negotiate and CredSSP are deferred behind NTLM. Domain
  single-sign-on and multi-hop scenarios are a later enhancement, not a
  v1 blocker.
- If a mature, license-compatible WinRM crate later appears, the thin
  client sits behind the same `Transport::exec(host, task) -> stream`
  interface as SSH and PsExec, so it can be swapped without touching the
  Batch Run executor.
