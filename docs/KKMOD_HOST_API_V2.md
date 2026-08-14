# KKMod Host API v2

Status: implementation contract

KKMod v2 is the only supported Custom Module contract. The host accepts only
packages whose manifest declares `apiVersion: 2`.

## Design rules

- Package identity always comes from the caller-bound native WebView session.
- Every host capability is denied unless it is declared in the manifest and
  approved at install or update time.
- Permission parameters are part of the grant. Widening an origin allowlist,
  file filter, quota, or write capability is a permission expansion.
- Host operations return typed errors and expose capability discovery. Modules
  must not infer support from user-agent strings.
- Potentially blocking filesystem, SQLite, keychain, archive, or network work
  runs away from the WebView IPC thread.
- Host window integration remains platform-correct: Custom Module WebView
  construction stays asynchronous to avoid a Windows WebView2 IPC deadlock,
  while macOS AppKit ordering is dispatched to the main thread.
- A module cannot veto hiding, suspension, shutdown, update, or uninstall.
- Modules never receive arbitrary Tauri commands, raw database access, a shell,
  terminal keystrokes, Connection secrets, or unrestricted filesystem access.

## Manifest

`kkterm-extension.json` is strict JSON. Unknown fields are rejected.

```json
{
  "id": "com.example.canvas",
  "name": "Canvas",
  "version": "2.0.0",
  "publisher": "Example",
  "summary": "An offline canvas",
  "apiVersion": 2,
  "homepage": "https://example.com/canvas",
  "license": {
    "name": "MIT",
    "file": "licenses/LICENSE",
    "noticesFile": "licenses/THIRD_PARTY_NOTICES.txt"
  },
  "permissions": {
    "storage": true,
    "documentStorage": true,
    "blobStorage": true,
    "browserStorage": true,
    "openExternal": true,
    "clipboard": true,
    "files": {
      "open": true,
      "save": true,
      "extensions": ["excalidraw", "json", "png", "svg"]
    },
    "networkFetch": {
      "origins": ["https://libraries.excalidraw.com"],
      "methods": ["GET"],
      "allowPrivateNetwork": false,
      "maxResponseBytes": 16777216
    },
    "secretReferences": false,
    "hostUi": true
  },
  "modules": [
    {
      "id": "canvas",
      "title": "Canvas",
      "icon": "dist/icon.svg",
      "entrypoint": "dist/index.html",
      "railVisible": true,
      "routing": "spa"
    }
  ]
}
```

Boolean permissions default to `false`. `files` and `networkFetch` default to
absent. File extensions are lowercase ASCII without a leading dot. A network
origin is an exact HTTPS origin with no credentials, query, fragment, or path.
HTTP is accepted only for an explicitly granted loopback/private origin when
`allowPrivateNetwork` is true. Redirects are revalidated against the same
allowlist. Request and response sizes, timeouts, and methods remain host-capped
even if the manifest asks for a larger value.

`routing` is `static` or `spa`. Static routing returns 404 for absent assets.
SPA routing falls back to that contribution's entrypoint only for navigation
requests whose final path has no file extension.

## Web runtime

Each installed package receives a stable, package-specific origin and WebView
profile. This isolates browser storage between packages and lets
`browserStorage` preserve `localStorage`, IndexedDB, and the Storage API across
launches. Without that permission, the host installs an in-memory localStorage
shim and disables IndexedDB, CacheStorage, and the Storage API. Cookies and
service workers are always disabled.

Dedicated same-package Web Workers and same-package frames are supported.
Remote frames remain blocked. Module navigation may remain inside the active
package only. Standard user-activated HTTP(S) anchors and `window.open` calls
are mediated through `openExternal`; programmatic top-level redirects stay
blocked.

The package protocol permits only packaged assets, data/blob images and fonts,
same-package frames, and same-package or blob dedicated workers. Network access
is available only through the host fetch API, not raw browser `fetch`, WebSocket,
EventSource, or WebRTC.

## JavaScript surface

The host injects one immutable `window.KKTerm` object. Every Promise rejection
is a `KKTermError` with `code`, `message`, and optional `details`.

```ts
interface KKTermHostV2 {
  readonly apiVersion: 2;
  readonly context: HostContext;
  ready(): Promise<void>;
  getContext(): Promise<HostContext>;
  getCapabilities(): Promise<CapabilitySnapshot>;
  openExternal(url: string): Promise<void>;
  storage: JsonKeyValueStore;
  documents: JsonDocumentStore;
  blobs: BlobStore;
  files: UserMediatedFiles;
  network: MediatedNetwork;
  secrets: SecretReferences;
  ui: HostUi;
  on(event: HostEvent, listener: (detail: unknown) => void): () => void;
}
```

Capability discovery returns the effective structured grant. APIs
remain present when ungranted and reject with `permission_denied`, avoiding
permission-dependent feature detection and brittle package code.

### Lifecycle events

- `contextChanged`: the host theme or locale changed.
- `visibilityChanged`: the contribution became visible or hidden.
- `focusChanged`: its native WebView gained or lost focus.
- `suspending`: flush volatile state promptly; the event is advisory and has a
  bounded deadline.
- `closing`: final non-vetoable notification before the runtime is destroyed.

### Storage

- `storage`: small structured-clone-compatible JSON values in SQLite.
- `documents`: large JSON documents in content-addressed app-data files.
- `blobs`: raw bytes with MIME type, size, SHA-256, timestamps, chunked reads and
  atomic writes. Blob bytes are never embedded as base64 in SQLite.
- `browserStorage`: durable WebView localStorage/IndexedDB for applications that
  require browser-native persistence.

All stores are package-scoped, quota-bound, visible in Settings, clearable by
the user, and included in full backup/restore with integrity metadata.

### User-mediated files

`files.open` and `files.beginSave` display an app-owned/native picker using the
declared extension filters. The module receives a session-scoped opaque token,
not a path. Reads and writes are chunked. Saves write and flush a sibling
temporary file, stage any existing target as a recoverable backup, then activate
the new file on `commit`; closing or runtime teardown abandons uncommitted data.

### Network and secrets

`network.fetch` accepts a URL, method, selected safe headers, and a bounded
body. The host enforces the manifest origins, resolves and rejects private or
loopback addresses unless explicitly granted, disables ambient credentials,
revalidates redirects, applies the global proxy policy, limits time and bytes,
and strips hop-by-hop and forbidden headers.

`secrets` exposes presence, delete, and app-owned entry/update requests for
package-owned references. Plaintext is never returned. A secret reference may
be attached to a mediated network request in an approved authentication header,
so the host reads it from the OS keychain without exposing it to module
JavaScript.

### Host UI

`ui.notice`, `ui.progress`, and `ui.clearProgress` are rendered by the app
through the shared Status Bar. `secrets.requestEntry` uses an app-owned dialog.
Modules cannot create native popup windows.

## Future broker extensions

Future APIs may add reduced non-secret Connection/Workspace reads and app-owned
proposal flows for mutations, terminal input, SFTP, screenshots, or one-time
external-browser returns. They are intentionally not v2 permissions today.
Adding one requires a real broker, consent UI, caller binding, tests, and a host
API version decision; manifests containing undeclared fields are rejected.

## Backup, removal, and updates

Full Settings backups use export format 2 and include package files, documents,
blobs, browser profile data, and SHA-256 integrity metadata alongside SQLite.
Selective Connection exports continue to exclude Modules. OS-keychain secret
values remain device-bound; only their non-secret references are in SQLite.
Settings reports per-package usage and lets the user clear all package data.
Uninstall offers retain or delete; delete also removes keychain references and
browser-profile data.

Updates are user-mediated. The catalog repeats the complete structured
permission object and must exactly match the downloaded manifest. Any widening
requires a fresh permission review. There is only one supported manifest and
runtime contract: API version 2.

## Expected base-app size

The v2 host embeds no editor engine and no module assets. Most implementation
uses dependencies already shipped by KKTerm (Tauri/WebView, reqwest, SQLite,
ZIP, hashing, Tokio, dialog, and keychain). The expected release increase is
roughly 0.2-0.8 MB compressed and 0.5-2 MB installed, plus about 15-40 KB gzip
for Settings/TypeScript UI. Individual `.kkmod` packages remain optional and do
not increase the base installer.
