# Local patches to vnc-rs 0.5.3

Vendored from crates.io 0.5.3. Divergence from upstream:

1. `src/client/auth.rs` — added `SecurityType::AppleDh = 30` and accept `30` in `TryFrom<u8>`.
2. `src/client/connector.rs` — added `username: Option<String>` field + `set_username` builder; added an Apple-auth branch in the `Authenticate` state.
3. `src/client/security/apple.rs` — NEW: Apple Remote Desktop (security type 30) Diffie-Hellman + AES-128-ECB credential exchange.
4. `src/client/security/mod.rs` — registered the `apple` module.
5. `Cargo.toml` — added `num-bigint`, `md-5`, `aes`, `rand` for the Apple handshake.
6. `src/client/auth.rs` — `SecurityType::read` (RFB 3.7/3.8) skips unknown
   security types instead of failing the handshake, so servers that advertise
   proprietary types (e.g. UltraVNC ids 0x68–0x76: SCPrompt, SessionSelect,
   MS-Logon I/II/III, SecureVNC plugin, ClientInit extra msg — 117 = 0x75)
   alongside standard VNC Auth still connect. Errors only if no advertised
   type is supported. Matches RFC 6143 §7.1.2 (client picks one supported
   type) and noVNC behavior (KKTerm issue #569).
7. `src/client/auth.rs` — RFB 3.3 branch reports out-of-range u32 security
   types (e.g. legacy UltraVNC MS-Logon 0xfffffffa) instead of truncating
   them to a meaningless u8 id.
8. `src/client/connector.rs` — the no-matching-security-type error now lists
   the types the server offered.
9. `src/client/connector.rs` / `src/client/messages.rs` — SetEncodings stores
   signed RFB encoding ids so Tight compression-level and JPEG-quality pseudo
   encodings can be advertised.
10. `src/client/connection.rs` / `src/event.rs` — framebuffer updates emit one
    completion event with wire-byte, decode-time, and per-encoding counters;
    the transport reader counts bytes without copying framebuffer payloads.

To upgrade: re-apply these changes onto the new upstream version, or upstream type-30 support and drop the vendor copy.
