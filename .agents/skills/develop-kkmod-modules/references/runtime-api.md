# KKMod runtime API — host API v2

The installed host and `docs/KKMOD_HOST_API_V2.md` are authoritative. Host API
v2 is the only runtime surface.

## Runtime boundary

Each contribution runs in a caller-bound borderless native WebView at a stable,
package-specific `kkmodule` origin. It receives only `custom_module_bridge`, not
KKTerm's ordinary Tauri commands. Package files are served with MIME headers, a
restrictive CSP, and a restrictive browser Permissions Policy.

The WebView fills the complete Custom Module child panel. KKTerm deliberately
does not add a contribution title/header row; the package owns its visible
title, navigation, and application chrome. The Activity Rail and Status Bar
remain host-owned outside the package surface.

Same-package frames and dedicated Workers are allowed. Remote frames, service
workers, direct cross-origin fetch/WebSocket/EventSource, cookies, CacheStorage,
popup windows, device/sensor/media/location APIs, arbitrary paths, shell access,
terminal input, database access, and raw Connection secrets are unavailable.
The bridge and browser-compatibility policy are injected into every
same-package frame.

`browserStorage` retains localStorage, IndexedDB, and the Storage API. Without
it, localStorage is session-memory only and IndexedDB/Storage are disabled.
Clipboard is native only with `clipboard`; otherwise every operation rejects.
This includes `navigator.clipboard`; do not add a fallback that bypasses the
grant.

The Rust command that constructs the native WebView must be `async`. Creating
it from a synchronous Tauri command can deadlock Windows WebView2 initialization.
On macOS, native overlay ordering must dispatch `NSWindow.orderFront` through
Tauri's main-thread runner because asynchronous startup runs on a Tokio worker
and AppKit window operations are main-thread-only.

## Injected API

```ts
interface KKTermHost {
  readonly apiVersion: 2;
  readonly context: HostContext;
  ready(): Promise<boolean>;
  getContext(): Promise<HostContext>;
  getCapabilities(): Promise<PermissionSnapshot>;
  openExternal(url: string): Promise<boolean>;
  storage: JsonStore;
  documents: DocumentStore;
  blobs: BlobStore;
  files: UserMediatedFiles;
  network: {
    fetch(request: NetworkRequest): Promise<NetworkResponse>;
    open(request: NetworkRequest): Promise<NetworkStreamOpened>;
    read(token: string): Promise<{ dataBase64: string; done: boolean }>;
    cancel(token: string): Promise<boolean>;
  };
  ai: HostAi;
  secrets: SecretReferences;
  ui: HostUi;
  on(event: HostEvent, listener: (detail: unknown) => void): () => boolean;
}
```

The object and namespaces are frozen. Rejections normalize to `KKTermError`
with `code`, `message`, and optional `details`. Capability discovery returns
the effective structured grant.

### Context and lifecycle

Context includes `apiVersion`, theme, and locale. Subscribe before long startup
work, apply `contextChanged`, and call `ready()` only when the usable UI or an
actionable startup error is rendered. The host timeout is 15 seconds.

The host context locale is the sole authority for Module language. Await a
fresh `getContext()` result before the Module initializes its localization
layer; the injected `window.KKTerm.context` object can be an earlier navigation
snapshot. Prefer an exact bundled locale, use a deliberately compatible
base-locale mapping only when necessary, and fall back to English only when the
host locale is unavailable. Keep `zh-TW` distinct from `zh-CN`. Apply later
`contextChanged` locale updates live, and do not persist or expose a separate
Module language choice that can override KKTerm.

Events are `contextChanged`, `visibilityChanged`, `focusChanged`, `suspending`,
and `closing`. Suspension/closing are bounded and non-vetoable; flush promptly.

### External links

`openExternal` accepts only HTTP(S) and is rate-limited. With the grant, the host
also intercepts genuine user-activated external anchors and `window.open` and
opens them in the system browser. Programmatic top-level redirects and native
popups remain blocked.

### Storage

- `storage.get/set/delete/list`: small JSON values, 10 MiB/10,000-key package
  quota.
- `documents.get/set/delete/list`: JSON documents, 64 MiB each, 512 MiB and
  4,096 keys per package; content-addressed outside SQLite.
- `blobs.beginWrite/write/commit/abort/read/delete/list`: raw MIME-tagged bytes,
  1 MiB chunks, 256 MiB each, 1 GiB and 16,384 keys per package.

All keys are package-scoped. Blob/document lists expose hashes, sizes, and
timestamps. Writes commit through temporary files and integrity metadata.

### Files

`files.open` and `files.beginSave` show a host picker restricted by the manifest
filters. Results contain a display name, size, mode, and opaque session token—
never a path. `read`/`write` use base64 chunks up to 1 MiB. `commit` activates a
temporary save; `close` or runtime teardown discards incomplete writes.

Browser file inputs and HTML5 file drops require effective `files.open` and are
rejected when a selected name falls outside the manifest extensions. Native
multi-select remains available because the browser exposes `File` objects, not
paths. Ordinary `<a download>` clicks for local Blob/data/same-package URLs are
automatically streamed through `files.beginSave`/`write`/`commit`; this covers
common browser export helpers, FileSaver-style anchors, and same-package PDF
viewer exports without per-app patches. The native WebView downloader is denied
as a backstop. Cross-origin download URLs are not adapted: use an exact
`network.fetch` grant to retrieve the bytes, then export a local Blob.

### Network and secrets

`network.fetch` takes URL, granted method, safe string headers, optional base64
body, and optional secret binding. The host checks the exact origin and DNS
addresses, blocks private/local targets unless granted, pins a vetted address,
applies the global proxy, disables redirects in the client and revalidates up
to five GET/HEAD redirects, caps time/body/headers, and does not expose cookies.

`secrets.has`, `requestEntry`, and `delete` operate on package-owned keychain
references. Secret entry is an app-owned password dialog. Plaintext is never
returned. A stored reference can be attached by the host to Authorization,
X-API-Key, or API-Key on a mediated fetch.

Use `network.open`/`read`/`cancel` for incremental or binary responses. Reads
are pull-based base64 chunks up to 256 KiB, retain the same origin/DNS/proxy/
redirect/secret safeguards as `network.fetch`, and share its declared total
response-byte cap. Handles are session-bound, limited to eight, and torn down
with the Module.

### Host UI

`ui.notice` routes transient info/success/warning/error messages through
KKTerm's Status Bar. `ui.progress` and `ui.clearProgress` use a module-local id
and 0–100 progress. Modules do not create native windows.

### Host AI

With `hostAi`, use `ai.getStatus`, `open`, `read`, `cancel`, and `openSettings`
to stream text from KKTerm's configured AI provider without receiving its key.
The broker disables tools, memories, Assistant custom instructions, and product
context; accepts bounded user/assistant history and an optional base64 image;
and never returns reasoning. `openSettings` navigates to Settings → AI
Assistant. Direct provider API credentials or GitHub Copilot are used; Codex,
Claude, and Cursor agent CLI modes are excluded because they can carry separate
tool and filesystem context. This permission may incur provider charges and
must be reviewed.

### Future product-data APIs

Connection, Workspace, terminal proposal, SFTP proposal, screenshot, and
external-return brokers are not part of v2. Do not declare or simulate those
permissions. A future host version may add them only with reduced DTOs,
caller-bound mediation, and app-owned review surfaces.

## CSP-friendly adaptation

- Bundle scripts, styles, fonts, WASM, and media below `dist/`.
- Use relative URLs and declare `routing: "spa"` only when history fallback is
  required.
- Use external script files; do not depend on remote CDN code.
- Replace raw fetch with `KKTerm.network.fetch` and declare exact origins.
- Replace filesystem paths with opaque host file tokens.
- Keep standard local `<a download>`/Blob export helpers when suitable; declare
  `files.save` and every possible output extension. Never point `download` at a
  remote URL.
- Inventory direct file inputs and drops separately from bridge calls; declare
  `files.open` and every supported input extension, then test multi-file flows.
- Put browser-native durable state behind `browserStorage`; prefer host stores
  for portable, inspectable data.
- Persist application-owned state explicitly. For Excalidraw this includes both
  scene/assets and `onLibraryChange` library items.

Always verify startup, persistence after restart, external links, focus/input,
workers/frames, lifecycle, overlay z-order, permissions, data deletion, and
disable/uninstall in the real Tauri runtime.
