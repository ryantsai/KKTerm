# BentoPDF KKMod corresponding source and build information

This package is an unofficial KKTerm API v2 adaptation of BentoPDF v2.8.7,
licensed under AGPL-3.0-only.

- Upstream source: https://github.com/alam00000/bentopdf
- Upstream tag: `v2.8.7`
- Upstream commit: `55915a29017a5090a6ea61e61b0f4d899f032923`
- Adaptation date: 2026-08-15

The adaptation removes service-worker registration and the home-page GitHub
API request, pins patched browser dependencies, supplies package-local WASM and
English OCR assets, delegates local browser exports to KKTerm's permission-bound
download mediation, and initializes KKTerm's API v2 lifecycle. RFC 3161 network
timestamping is limited to `POST https://freetsa.org/tsr` through
`KKTerm.network.fetch`; the other upstream TSA presets and arbitrary TSA URLs
are unavailable. It does not include a v1 manifest or runtime fallback.

All seven EmbedPDF auxiliary viewer font packs are included and resolve to
package-local URLs, so those paths never attempt undeclared network access.
BentoPDF's primary PDF.js CMaps and standard fonts are packaged as well.

To reproduce the browser build, clone the exact upstream tag, run
`scripts/apply-adaptation.mjs` from the KKTerm source tree, install the resulting
lockfile, stage the runtime assets named in `VENDORED_COMPONENTS.md`, and run
the adapted cross-platform `npm run build`. The adaptation pins the package-local
WASM defaults and absolute same-package OCR worker/core/language/font routes,
and exposes only the bundled English OCR language. Then run
`scripts/finalize-dist.mjs` and the KKMod v2 validator/packer.

The complete KKTerm-specific adapter source is included as
`KKTERM_ADAPTER_SOURCE.txt`. The remaining corresponding source is available
from the immutable upstream commit above.
