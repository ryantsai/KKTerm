---
name: develop-kkmod-modules
description: Design, scaffold, adapt, build, validate, package, and prepare publication metadata for KKTerm Custom Modules (`.kkmod`). Use when Codex needs to create a KKMod module, convert an existing browser app such as Excalidraw into an optional KKTerm Module, troubleshoot package validation or host API integration, produce a signed-catalog entry, or review a module for KKTerm host API v1 compatibility and licensing.
---

# Develop KKMod Modules

Build optional static web applications for KKTerm's isolated Custom Module runtime. Treat the installed KKTerm host implementation as authoritative.

## Mandatory preflight gate

Before creating, editing, generating, installing, or packaging module files:

1. Inspect the proposed app and identify whether it needs a server, remote APIs, workers, frames, popups, persistent browser storage, clipboard/device APIs, arbitrary filesystem access, or Node.js at runtime.
2. Present this warning, adapted with concrete findings:

   > KKMod host API v1 runs only local static browser assets in an isolated native WebView. It provides no HTTP/Node.js runtime, remote network access, workers, frames, popups, arbitrary filesystem or terminal access, persistent browser storage, media/device/sensor APIs, or direct Tauri commands. Durable non-secret settings, large JSON documents/encoded blobs, external HTTP(S) links, and WebView clipboard access require the declared `storage`, `documentStorage`, `openExternal`, and `clipboard` permissions respectively. The Module must signal readiness within 15 seconds.

3. Classify the request as **compatible**, **compatible with adaptation**, or **incompatible with v1**. Name every required adaptation and requested permission.
4. Ask: **“Proceed with KKMod host API v1 under these constraints?”**
5. Stop before file mutations until the user explicitly confirms. Read-only inspection is allowed. If incompatible, propose a static/offline design or a host-platform change; do not silently remove core behavior.

Present this gate once per development task. A user's explicit acceptance of these exact constraints in the current request counts as confirmation, but still report the compatibility classification before editing.

## Load the contract

Read both references completely before implementation:

- [Package contract](references/package-contract.md) — archive structure, strict manifest and catalog schemas, path/type/size rules, and licensing.
- [Runtime API](references/runtime-api.md) — supported host features, bridge signatures, events, CSP, unavailable browser APIs, and adaptation patterns.

When working inside a KKTerm checkout, also read `docs/CUSTOM_MODULE_PACKAGING.md` and the constants, manifest structs, validators, initialization script, bridge, and protocol response in `src-tauri/src/custom_modules.rs`. If they differ from this skill, follow the checkout and update this skill if requested.

When changing the KKTerm host itself, keep every Tauri command that constructs a Custom Module `WebviewWindow` asynchronous. On Windows, WebView2 window construction from a synchronous command can deadlock Tauri's IPC dispatcher, leaving `window.KKTerm.ready()` and unrelated invokes pending.

## Workflow

1. **Define the outcome.** Record the package id, publisher, semantic version, license, contribution ids/titles, offline behavior, durable-data needs, external links, and source/build toolchain.
2. **Audit feasibility.** Inventory every runtime URL, dependency, worker/service worker, iframe, inline script, navigation route, browser persistence call, device API, secret, font, asset, and license. Resolve each against the runtime reference.
3. **Choose the starting point.** For a new module, copy `assets/starter-kkmod/`. For an existing app, preserve its source project but emit a self-contained production build into `dist/`.
4. **Adapt for isolation.** Use relative local asset URLs, external script files, hash/in-memory routing, browser file inputs for deliberate imports, and the narrow `window.KKTerm` bridge. Remove runtime CDN/API dependencies. Do not expose secrets through module storage.
5. **Declare least privilege.** Request `storage` only for small durable non-secret JSON settings, `documentStorage` only for large JSON documents or encoded browser blobs, `openExternal` only when the Module opens HTTP(S) URLs in the system browser, and `clipboard` only when users need copy/paste or image transfer through the OS clipboard.
6. **Integrate lifecycle.** Read initial context, subscribe to `contextChanged`, apply theme/locale changes, handle bridge rejections, and call `window.KKTerm.ready()` only after the usable UI has initialized. Finish within 15 seconds.
7. **Audit licenses.** Include the package's license and all required third-party notices. Recheck bundled dependencies, fonts, icons, examples, and media for the exact release version.
8. **Validate and package.** Run:

   ```powershell
   python <skill-dir>\scripts\kkmod_tool.py check <module-root>
   python <skill-dir>\scripts\kkmod_tool.py pack <module-root> <name>.kkmod
   python <skill-dir>\scripts\kkmod_tool.py check <name>.kkmod
   ```

9. **Verify behavior.** Test in the real Tauri desktop runtime: startup/readiness, keyboard and focus, resizing, theme/locale updates, overlay visibility, restart persistence, permissions, clipboard copy/paste when granted, offline startup, disable/uninstall, and URL/RDP overlap. Browser/Vite preview is insufficient for native integration. If host code changed, also verify that starting a Module does not stall unrelated main-window Tauri invokes.
10. **Prepare publication only when requested.** Generate catalog metadata from the final immutable archive, sign its lowercase SHA-256 text outside the repository, and keep the private key out of source and package files.

## Completion report

Report:

- compatibility classification and adaptations made;
- package id/version, contributions, permissions, and license/notices;
- `.kkmod` path, byte size, SHA-256, expanded size, and file count;
- validation and real-runtime checks performed;
- any remaining release-QA or catalog-signing work.

Never claim catalog readiness without a dependency/license audit, immutable HTTPS artifact, matching metadata, and valid Ed25519 signature.
