# ADR 0013: Use winrm-rs for the IT Ops WinRM Transport

## Status

Accepted

## Context

ADR 0012 found no license-compatible turnkey WinRM client in June 2026 and
therefore required KKTerm to build a small WS-Man client from `reqwest`, `sspi`,
and `quick-xml`. By August 2026, `winrm-rs` 1.1.2 is available under
MIT OR Apache-2.0. It provides the required cross-platform asynchronous WS-Man
shell lifecycle, NTLMv2 password authentication, HTTP/HTTPS listeners, bounded
connection and operation timeouts, output limits, and certificate-validation
policy without introducing a GPL or Windows-only runtime dependency.

Maintaining an independent SOAP and NTLM implementation no longer gives KKTerm
a useful product advantage. It would duplicate the same protocol surface and
carry more authentication, cleanup, and fault-parsing risk.

## Decision

Use `winrm-rs` with default features disabled behind the existing IT Ops
`BatchTransport` boundary.

- Version-pin through Cargo's normal lockfile and keep the dependency limited to
  the IT Ops runner.
- Use NTLM password authentication for the first release. Kerberos, certificate
  authentication, Basic authentication, and experimental CredSSP are not
  exposed by KKTerm.
- Keep credentials in the existing OS-backed saved credential vault. Resolve
  them before worker fan-out, keep plaintext in memory only for the run, redact
  any occurrence from transport output, and never persist it in Host or Run
  History data.
- Support Script Tasks over WinRM. Interactive expect-style Playbooks remain
  SSH-only until the transport has a proven interactive-channel design.
- Preserve explicit per-Host HTTP/HTTPS, custom-port, and invalid-certificate
  settings. HTTPS certificate validation remains on unless the operator opts
  out for that Host.
- Continue to execute WinRM work inside the bounded Batch Run worker pool, on a
  dedicated Tokio runtime rather than the UI/native thread.

## Consequences

- ADR 0012's license and cross-platform constraints remain satisfied, while its
  "do not take a WinRM crate dependency" decision is superseded.
- KKTerm depends on a comparatively young crate. The `BatchTransport` boundary
  keeps replacement local if maintenance, security, or interoperability proves
  inadequate.
- WinRM runs PowerShell in the authenticated user's Windows security context.
  It does not provide a LocalSystem switch; PsExec remains the transport for
  explicit user, elevated-user, LocalSystem, or limited-user execution.
