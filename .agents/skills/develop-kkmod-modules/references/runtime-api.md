# KKMod runtime API — host API v1

## Contents

- Supported features
- JavaScript API
- Lifecycle
- Security policy
- Adaptation patterns
- Desktop verification

## Supported features

- Static HTML, CSS, JavaScript/ES modules, JSON, images, fonts, source maps, XML/web manifests, and local WASM.
- One or more permanent Activity Rail Module contributions per package.
- Dedicated borderless native WebView hosted within KKTerm without localhost services.
- Host context containing API version, current KKTerm theme id, and locale.
- Live `contextChanged` events for theme/locale changes.
- Optional isolated, quota-bound durable JSON storage.
- Optional filesystem-backed, quota-bound durable JSON document and encoded-blob storage.
- Optional opening of HTTP(S) URLs in the system browser.
- Optional native WebView clipboard access for copy/paste and image transfer.
- Browser file inputs for files deliberately selected by the user.
- Offline operation after package installation.

## JavaScript API

The host injects `window.KKTerm` before package scripts run:

```ts
interface KKTermContext {
  apiVersion: 1;
  theme: string;
  locale: string;
}

interface KKTermHost {
  readonly apiVersion: 1;
  readonly context: KKTermContext;
  ready(): Promise<boolean>;
  getContext(): Promise<KKTermContext>;
  openExternal(url: string): Promise<boolean>;
  storage: {
    get(key: string): Promise<unknown | null>;
    set(key: string, value: unknown): Promise<boolean>;
    delete(key: string): Promise<boolean>;
    list(): Promise<string[]>;
  };
  documents: {
    get(key: string): Promise<unknown | null>;
    set(key: string, value: unknown): Promise<boolean>;
    delete(key: string): Promise<boolean>;
    list(): Promise<Array<{
      key: string;
      sha256: string;
      byteSize: number;
      updatedAt: string;
    }>>;
  };
  on(event: "contextChanged", listener: (context: KKTermContext) => void): () => boolean;
}

declare global {
  interface Window { KKTerm: KKTermHost }
}
```

All methods are asynchronous and may reject. Do not access `window.__TAURI_INTERNALS__` or invoke Tauri commands directly.

### Context and readiness

```js
function applyContext(context) {
  document.documentElement.dataset.theme = context.theme;
  document.documentElement.lang = context.locale;
}

window.KKTerm.on("contextChanged", applyContext);
applyContext(await window.KKTerm.getContext());

// Initialize a usable UI first, then signal readiness once.
await window.KKTerm.ready();
```

KKTerm reports an error when a Module does not signal readiness within 15 seconds. Repeated `ready()` calls are harmless but unnecessary.

### Storage permission

Declare `"storage"` before calling the storage API.

- Values must be JSON-serializable. `undefined`, functions, cyclic objects, blobs, and class instances are unsuitable.
- Keys must be 1–256 characters and contain no control characters.
- Quota is 10 MiB per package id, including key and serialized JSON sizes.
- Limit is 10,000 keys per package id.
- Data is non-secret and isolated by package id. It survives Module sessions and upgrades until the user deletes it.
- `get()` returns `null` for a missing key. `list()` returns keys in sorted order.

Do not store credentials, tokens, private keys, connection secrets, or sensitive document content unless the product explicitly accepts non-secret local storage semantics.

### Document-storage permission

Declare `"documentStorage"` before calling the documents API.

- Values must be JSON-serializable. Large browser blobs must be encoded as strings such as data URLs; raw `Blob` objects are not accepted.
- Keys follow the storage-key rules: 1–256 characters with no control characters.
- Content is stored as immutable SHA-256-addressed JSON files under app data. SQLite stores only the package-scoped key, content hash, byte size, and update timestamp.
- Quota is 512 MiB per package id, with at most 4,096 keys and 64 MiB per document.
- `get()` verifies stored size and SHA-256 before parsing JSON. `list()` returns metadata and never returns content.
- Replacing or deleting a key removes content files once no key in that package references them.
- Data is non-secret and isolated by package id. It survives Module sessions, upgrades, and an uninstall that retains data; the explicit delete-data uninstall removes it.
- Database-only backups and Settings exports retain document metadata, not the external document files.

Use `storage` for small settings and `documents` for larger scene files or encoded assets. Do not store credentials, tokens, private keys, Connection secrets, or other secrets in either API.

### External-link permission

Declare `"openExternal"` before calling `openExternal(url)`. Only valid absolute HTTP(S) URLs are accepted. Requests are rate-limited to one per second per runtime session and open in the system browser.

## Runtime security policy and unavailable features

Every asset response receives:

```text
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self';
object-src 'none';
frame-src 'none';
worker-src 'none';
base-uri 'none';
form-action 'none'
```

Consequences:

- Put executable JavaScript in local external files; inline scripts and remote/CDN scripts are blocked.
- Bundle all assets. Runtime fetch/XHR/WebSocket calls to remote origins are blocked.
- Workers and service workers are blocked. Adapt worker-based libraries to a main-thread or host-supported build.
- Frames/iframes, objects, form submission, popup windows, and navigation away from the package origin are denied.
- Use relative URLs. Prefer hash or in-memory routing; there is no server fallback for SPA paths.
- Local WASM works; worker-backed WASM runtimes do not.

The Permissions Policy denies camera, microphone, display capture, geolocation, accelerometer, gyroscope, magnetometer, MIDI, Bluetooth, HID, serial, USB, payment, credentials, wake lock, web share, window management, XR, and similar ambient capabilities. Clipboard access is enabled only for a package that declares and is granted `clipboard`.

The host replaces or removes durable browser stores:

- `localStorage` is an in-memory compatibility shim for the current WebView session only.
- IndexedDB, Cache Storage, `navigator.storage`, and cookies are unavailable. Without the `clipboard` permission, `navigator.clipboard` is a nonfunctional compatibility shim whose methods reject with `NotAllowedError`. With the permission, the native WebView clipboard API remains available.

Also unavailable in v1:

- Node.js or any application/HTTP server at runtime;
- arbitrary host filesystem access (browser file input remains available);
- terminal, Connection, Session, Dashboard, keychain, shell, process, or private KKTerm APIs;
- background execution after the native Module WebView closes;
- secret storage or cross-package storage access.

Bridge requests are caller-bound to a registered `custom-module-*` WebView. Ordinary requests are capped at 11 MiB serialized payload; `documents.set` allows a bounded 65 MiB bridge payload so its JSON value can reach the 64 MiB per-document limit. Packages receive only declared permissions.

## Adaptation patterns

| Existing dependency | V1 adaptation |
|---|---|
| REST/GraphQL/WebSocket backend | remove it, bundle immutable data, or declare the app incompatible pending a future permission/API |
| Node/Express runtime | compile to a static browser build; never ship the server |
| CDN scripts/fonts/assets | vendor them into `dist/` and complete license attribution |
| IndexedDB/localStorage persistence | map durable non-secret state to `window.KKTerm.storage`; keep transient state in memory |
| Large JSON documents or encoded browser blobs | split content into bounded values and store it through `window.KKTerm.documents` |
| Service/web worker | use a supported main-thread build or declare incompatibility |
| Clipboard API | declare `clipboard`, use the standard `navigator.clipboard` API after a user action, and handle permission rejection |
| Arbitrary file reads/writes | use `<input type="file">` for deliberate import and browser download/export where supported |
| External anchor/navigation | prevent in-WebView navigation and call `openExternal()` after a user action |
| Browser history routes | use hash/in-memory routing and relative asset URLs |
| Secrets/tokens | redesign to avoid them; v1 has no secret bridge |

Never emulate a prohibited capability through private Tauri internals, loopback servers, shell commands, hidden executables, or encoded payloads.

## KKTerm host implementation constraint

This rule applies when maintaining the KKTerm host, not to package JavaScript:

- A Tauri command that constructs a Custom Module `WebviewWindow` must be `async`.
- On Windows, calling `WebviewWindowBuilder::new(...).build()` from a synchronous command can deadlock WebView2 and Tauri's IPC dispatcher.
- The visible symptom is a child WebView that begins creation but never completes `window.KKTerm.ready()`; unrelated main-window invokes may remain pending too.
- Preserve a policy test for the asynchronous command boundary and verify native Module startup on Windows after changing window construction.

## Desktop verification

Validate in the real Tauri app, not only Vite or a normal browser:

- local-file review, install, enable, Activity Rail visibility, restart, rollback, uninstall, and optional data deletion;
- ready success and deliberate timeout/error behavior;
- keyboard, pointer, focus, resize/move, and high-DPI bounds;
- context changes for every supported theme/locale flow;
- storage/document isolation, quota errors, content-integrity errors, permission denial, and offline restart;
- external link scheme rejection and one-second rate limit;
- dialogs/popovers and URL/RDP native-surface overlap;
- Windows, macOS, and Linux release targets before publication.
