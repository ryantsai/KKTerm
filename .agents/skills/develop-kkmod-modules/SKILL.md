---
name: develop-kkmod-modules
description: Design, scaffold, adapt, build, validate, package, and prepare publication metadata for KKTerm Custom Modules (`.kkmod`). Use when Codex needs to create a KKMod module, convert an existing browser app such as Excalidraw into an optional KKTerm Module, troubleshoot package validation or host API integration, produce a signed-catalog entry, or review a module for KKTerm host API v2 compatibility and licensing.
---

# Develop KKMod Modules

Build optional static web applications for KKTerm's isolated Custom Module runtime. Treat the installed KKTerm host implementation as authoritative.

## Mandatory preflight gate

Before creating, editing, generating, installing, or packaging module files:

1. Inspect the proposed app and identify whether it needs a server, remote APIs, workers, frames, popups, persistent browser storage, clipboard/device APIs, arbitrary filesystem access, or Node.js at runtime.
2. Present this warning, adapted with concrete findings:

   > KKMod host API v2 runs local static browser assets in an isolated native WebView. It provides no HTTP/Node.js runtime, service workers, remote frames, arbitrary shell/terminal/database access, media/device/sensor APIs, product-data brokers, or direct Tauri commands. Durable JSON, raw blobs, browser-native persistence, external links, clipboard, user-mediated files, bounded outbound requests, secret references, and Status Bar host UI each require an explicit structured permission. The Module must signal readiness within 15 seconds.

3. Classify the request as **compatible**, **compatible with adaptation**, or **incompatible with v2**. Name every required adaptation and requested permission.
4. Ask: **“Proceed with KKMod host API v2 under these constraints?”**
5. Stop before file mutations until the user explicitly confirms. Read-only inspection is allowed. If incompatible, propose a static/offline design or a host-platform change; do not silently remove core behavior.

Present this gate once per development task. A user's explicit acceptance of these exact constraints in the current request counts as confirmation, but still report the compatibility classification before editing.

## Load the contract

Read both references completely before implementation:

- [Package contract](references/package-contract.md) — archive structure, strict manifest and catalog schemas, path/type/size rules, and licensing.
- [Runtime API](references/runtime-api.md) — supported host features, bridge signatures, events, CSP, unavailable browser APIs, and adaptation patterns.

When working inside a KKTerm checkout, also read `docs/CUSTOM_MODULE_PACKAGING.md` and the constants, manifest structs, validators, initialization script, bridge, and protocol response in `src-tauri/src/custom_modules.rs`. If they differ from this skill, follow the checkout and update this skill if requested.

When changing the KKTerm host itself, keep every Tauri command that constructs a Custom Module `WebviewWindow` asynchronous. On Windows, WebView2 window construction from a synchronous command can deadlock Tauri's IPC dispatcher, leaving `window.KKTerm.ready()` and unrelated invokes pending. On macOS, dispatch AppKit window ordering through Tauri's main-thread runner; calling `NSWindow.orderFront` from the asynchronous startup worker can terminate KKTerm when a Custom Module starts or is restored at launch.

## Workflow

1. **Define the outcome.** Record the package id, publisher, semantic version, license, contribution ids/titles/icons, offline behavior, durable-data needs, external links, and source/build toolchain. Design the packaged application as an edge-to-edge child-panel surface with its own visible title, navigation, and application chrome; KKTerm deliberately supplies no per-Module header. For KKTerm-curated publication, every rail-visible contribution needs distinct, attributable SVG artwork suitable for a monochrome Activity Rail mask.
2. **Audit feasibility.** Inventory every runtime URL, dependency, worker/service worker, iframe, inline script, navigation route, browser persistence call, device API, secret, font, asset, and license. Resolve each against the runtime reference.
3. **Choose the starting point.** For a new module, copy `assets/starter-kkmod/`. For an existing app, preserve its source project but emit a self-contained production build into `dist/`.
4. **Adapt for isolation.** Use relative local asset URLs, external script files, declared `static`/`spa` routing, same-package workers/frames, and the narrow `window.KKTerm` bridge. Replace runtime CDNs and direct cross-origin fetches with packaged assets or `network.fetch`. Standard local Blob/data/same-package `<a download>` helpers may remain because the host mediates them through `files.save`; remote download URLs may not. Do not expose secrets through module storage. Validate the final packaged HTML, not only source templates: every local HTML asset reference must resolve inside the package's `dist/` directory. Reject root-absolute references such as `/assets/app.js` and traversal such as `../../assets/app.js` from `dist/*.html`; use `./assets/app.js` (or the correct relative path for nested pages).
5. **Declare least privilege.** Use the structured permission object. Request only the store, browser persistence, clipboard, external link, file filters, exact network origins/methods, secret references, and host UI the Module actually uses. Inventory browser file inputs/drops plus every import and export extension, not only explicit `KKTerm.files` calls. Product-data proposal permissions are not part of v2.
6. **Integrate lifecycle.** Read initial context/capabilities; subscribe to `contextChanged`, `visibilityChanged`, `focusChanged`, `suspending`, and `closing`; apply theme/locale changes; handle typed bridge errors; and call `window.KKTerm.ready()` only after the usable UI has initialized. Finish within 15 seconds. KKTerm's UI locale is authoritative: await a fresh `window.KKTerm.getContext()` before initializing Module i18n because the injected `window.KKTerm.context` may be a startup snapshot during same-WebView navigation. Select the exact bundled host locale first, then an intentional compatible base-locale mapping, and fall back to English only when no translation exists. Preserve distinctions such as `zh-TW` versus `zh-CN`; never map Taiwan Chinese to a Mainland Chinese translation. Apply later `contextChanged` locale updates live, and remove or disable any Module-owned language preference or picker that could drift from KKTerm.
7. **Audit licenses.** Include the package's license and all required third-party notices. Recheck bundled dependencies, fonts, icons, examples, and media for the exact release version. Record the source and license of curated Activity Rail artwork.
8. **Validate and package.** Run:

   ```powershell
   python <skill-dir>\scripts\kkmod_tool.py check <module-root>
   python <skill-dir>\scripts\kkmod_tool.py pack <module-root> <name>.kkmod
   python <skill-dir>\scripts\kkmod_tool.py check <name>.kkmod
   ```

9. **Verify behavior.** Test in the real Tauri desktop runtime: startup/readiness, keyboard and focus, resizing, theme/locale updates, overlay visibility, restart persistence, permissions, clipboard copy/paste when granted, native and drag/drop file input, every distinct local export/download helper, save cancellation, offline startup, disable/uninstall, and URL/RDP overlap. Exercise every distinct generated HTML entry (or crawl them automatically) so broken asset paths cannot hide on secondary tool pages. Verify at least one supported non-English KKTerm locale and one unsupported locale that must fall back to English. For Windows portable builds, verify install, restart, folder move, and update retention with SQLite metadata in `data/kkterm.sqlite3` and every package/document/WebView/catalog/download/staging artifact below `data/custom-modules/`. Browser/Vite preview is insufficient for native integration. If host code changed, also verify that starting a Module does not stall unrelated main-window Tauri invokes.
10. **Prepare publication only when requested.** Ensure every rail-visible curated contribution declares an inert packaged SVG icon no larger than 64 KiB; KKTerm renders it as a monochrome `currentColor` mask. Generate catalog metadata from the final immutable archive, sign its lowercase SHA-256 text outside the repository, and keep the private key out of source and package files.

## Completion report

Report:

- compatibility classification and adaptations made;
- package id/version, contributions, permissions, and license/notices;
- `.kkmod` path, byte size, SHA-256, expanded size, and file count;
- validation and real-runtime checks performed;
- any remaining release-QA or catalog-signing work.

Never claim catalog readiness without a dependency/license audit, immutable HTTPS artifact, matching metadata, and valid Ed25519 signature.
