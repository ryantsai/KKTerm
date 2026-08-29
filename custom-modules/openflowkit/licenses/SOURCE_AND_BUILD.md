# OpenFlowKit KKMod corresponding source and build information

This package is an unofficial KKTerm API v2 adaptation of OpenFlowKit's latest
upstream `main` snapshot, licensed under MIT.

- Upstream source: https://github.com/Vrun-design/openflowkit
- Upstream commit: `0d6a7fc4b5bd9c7d7fc8bb5f1e995e691473da5e`
- Upstream package version: `0.1.1`
- KKMod adaptation version: `0.2.1`
- Adaptation date: 2026-08-29

OpenFlowKit publishes no GitHub releases, and its latest `v0.1.1` tag predates
major functionality already shipped by this Module while the current upstream
`main` branch still declares package version `0.1.1`. The immutable commit above
is therefore the reproducible source pin for this package.

The adaptation replaces browser-owned AI credentials and provider transports
with KKTerm's permission-gated host AI broker, follows KKTerm theme and locale,
signals readiness after local-first initialization, disables the service worker,
removes remote font loading and public-site/PWA metadata, and makes packaged
public asset URLs relative to the Module route. The Module exposes no
independent language selector and follows the host locale. `zh-TW` falls back
to English rather than Simplified Chinese because upstream does not bundle a
distinct Taiwan locale.

To reproduce the package, clone the exact upstream commit, run
`scripts/apply-adaptation.mjs` from this directory, install dependencies, build
upstream, and run `scripts/build-dist.mjs`. Then validate and pack with the
KKMod API v2 tool.
