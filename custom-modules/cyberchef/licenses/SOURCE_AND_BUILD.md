# CyberChef KKMod corresponding source and build information

This package is an unofficial KKTerm API v2 adaptation of CyberChef v11.3.0,
licensed under Apache-2.0.

- Upstream source: https://github.com/gchq/CyberChef
- Upstream tag: `v11.3.0`
- Upstream commit: `d24ba1afce2e3a080308b5df7db033332fe94a1a`
- Adaptation date: 2026-08-31

The adaptation keeps CyberChef local-only. It omits the `HTTP request`,
`DNS over HTTPS`, and `Show on map` operations because KKMod host API v2 does
not grant arbitrary network access. It converts CyberChef's blob-backed worker
bundles to packaged same-origin workers, replaces inline/eval presentation
hooks with CSP-safe packaged code, removes browser-native prompts, routes
transient notices through KKTerm's Status Bar, and delegates open/save and
downloads to KKTerm's permission-bound browser mediation.

CyberChef settings, favourites, and saved recipes use its isolated persistent
browser storage. Its English-only interface intentionally falls back to
English for every host locale while following live KKTerm theme changes. File
inputs are capped below 256 MiB to bound WebView memory use. The package asks
for all file extensions because CyberChef is a general-purpose binary analysis
tool and file extensions do not determine its supported inputs.

The adaptation pins DOMPurify 3.4.14 and Jimp 1.6.1 over the exact upstream
lockfile to include current fixes available at build time. The package includes
the upstream license, a generated dependency inventory, deduplicated license
texts, vendored-component notices, and the complete KKTerm adapter source.

To reproduce the browser build, clone the exact upstream tag and verify the
commit above. From the KKTerm source tree, run:

```powershell
node custom-modules/cyberchef/scripts/apply-adaptation.mjs <cyberchef-checkout>
npm install --ignore-scripts --prefix <cyberchef-checkout>
npm run postinstall --prefix <cyberchef-checkout>
node custom-modules/cyberchef/scripts/apply-dependency-adaptation.mjs <cyberchef-checkout>
node --max-old-space-size=4096 <cyberchef-checkout>/node_modules/grunt-cli/bin/grunt kkmod --base <cyberchef-checkout>
node custom-modules/cyberchef/scripts/finalize-dist.mjs <cyberchef-checkout>
node custom-modules/cyberchef/scripts/generate-third-party-notices.mjs <cyberchef-checkout>
```

Then validate and package the module with the KKMod v2 development tool. The
Node build toolchain and `node_modules` directory are not included in the
`.kkmod` archive.
