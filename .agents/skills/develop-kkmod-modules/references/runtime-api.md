# KKMod runtime API — host API v2

The installed host and `docs/KKMOD_HOST_API_V2.md` are authoritative. Host API
v2 is the only runtime surface.

## Runtime boundary

Each contribution runs in a caller-bound borderless native WebView at a stable,
package-specific `kkmodule` origin. It receives only `custom_module_bridge`, not
KKTerm's ordinary Tauri commands. Package files are served with MIME headers, a
restrictive CSP, and a restrictive browser Permissions Policy.

Same-package frames and dedicated Workers are allowed. Remote frames, service
workers, direct cross-origin fetch/WebSocket/EventSource, cookies, CacheStorage,
popup windows, device/sensor/media/location APIs, arbitrary paths, shell access,
terminal input, database access, and raw Connection secrets are unavailable.

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
  network: { fetch(request: NetworkRequest): Promise<NetworkResponse> };
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

### Host UI

`ui.notice` routes transient info/success/warning/error messages through
KKTerm's Status Bar. `ui.progress` and `ui.clearProgress` use a module-local id
and 0–100 progress. Modules do not create native windows.

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
- Put browser-native durable state behind `browserStorage`; prefer host stores
  for portable, inspectable data.
- Persist application-owned state explicitly. For Excalidraw this includes both
  scene/assets and `onLibraryChange` library items.

Always verify startup, persistence after restart, external links, focus/input,
workers/frames, lifecycle, overlay z-order, permissions, data deletion, and
disable/uninstall in the real Tauri runtime.
