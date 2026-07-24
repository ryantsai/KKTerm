# 08 — URL Connections

## AI grep hints

- Keys: `webview.*` (full namespace), `connections.embeddedWebApp`
- Topics: URL Connection, embedded WebView2, HTTP proxy, HTTPS proxy, SOCKS5 proxy, direct connection, proxy override, address bar, back/forward/reload, auto-refresh, save form data, restore form data, credential fill, password capture, external open, saved Pane layout, Shift-click link, download folder, download progress, downloads, URL Connection debug log, tutorial targets `webview.toolbar`, `webview.address`, `webview.openExternally`, `webview.autoRefresh`, `webview.savePassword`, `webview.fillCredential`, `webview.sendToAi`, `webview.surface`
- Synonyms: "open a webpage", "embed a site", "browser tab", "internal web tool", "fill in saved password", "save form data", "restore form fields", "remember what I typed", "open link in browser", "external browser", "url.connection.debug.log", "URL debug log"

> **Term:** a **URL Connection** is a Connection of kind `url` storing one http(s) URL, an optional `dataPartition` label, and a proxy routing choice. The `dataPartition` field is persisted but currently a no-op. Settings -> URL can provide the global default shard and user agent, and the add/edit Connection dialog's right-column `connections.urlOptions` can override them per URL Connection. On Windows, proxied Sessions use an internal data directory per effective proxy so WebView2 Environments with different proxy arguments can coexist; this isolation is an implementation requirement, not the user-facing `dataPartition` feature.

## Proxy routing

URL Tabs that inherit defaults follow the global app proxy in Settings → Proxy (`settings.proxy`): `settings.proxyModeSystem` uses the operating system proxy, `settings.proxyModeNone` forces a direct connection, and `settings.proxyModeManual` applies an `settings.proxyHttp`, `settings.proxyHttps`, or `settings.proxySocks5` endpoint. An HTTP/HTTPS proxy carries both HTTP and HTTPS destination traffic. Proxy authentication and bypass/PAC rules are not supported by Tauri's per-WebView proxy API.

Each URL Connection can use `connections.inheritSettingsDefaults` (follow the global app proxy), force `settings.urlProxyDirect`, or persist its own HTTP/SOCKS5 endpoint that wins over the global value. The same right-column options group controls the URL data shard: inheriting uses the Settings -> URL default, while turning inheritance off stores a per-Connection value. The effective proxy, data shard, and user agent are fixed when the URL Session opens; close and reopen an existing Tab after changing proxy or shard settings. Windows applies the endpoint to WebView2 and isolates WebView2 user data by effective proxy, Linux applies it to WebKitGTK, and macOS applies it to WKWebView through Network.framework. macOS requires version 14 or later for per-WebView proxy support.

When Settings -> URL enables `settings.ignoreCertificateErrors`, newly opened URL Sessions accept invalid HTTPS server certificates, including self-signed certificates. Windows handles this through WebView2's certificate error callback; macOS marks the WKWebView and answers its server-trust authentication challenge with a trust credential. WKWebView does not expose Safari's manual "continue to this website" certificate-warning page to embedded apps, so this delegate challenge path is the macOS equivalent. Keep this scoped to URL Sessions that opt into the setting; do not make the main app WebView trust invalid certificates globally.

On macOS, when certificate validation remains enabled and WKWebView rejects an invalid HTTPS certificate, the URL Session emits a `webview.invalidCertificateWarning` warning through the Status Bar popup, including for the first URL Session opened in an app run. The backend installs the server-trust and provisional/final navigation-failure callbacks on Wry's navigation delegate, then detaches and reattaches that retained delegate so WebKit recognizes the runtime-added callbacks on the first WKWebView. The warning still appears when WebKit leaves the URL Pane blank and directs the user to Settings -> URL if they choose to disable certificate validation for newly opened URL Sessions.

## Surface

In the desktop runtime, a URL Pane hosts a real WebView2 browser in a stable, borderless, owned `WebviewWindow`. The frontend computes the Pane's DOM rectangle, the Rust backend converts that to screen coordinates, and the overlay window is moved/sized so the WebView client area covers the Pane. On Windows, KKTerm strips residual non-client frame styles from the owned overlay window before positioning it. The overlay is hidden when the Tab, Dashboard View, Dashboard Module, or URL Pane is inactive. When a registered app-owned dialog or advanced DOM popover intersects it, KKTerm first captures a transient snapshot into the Pane, then hides the live overlay window until the UI closes. Right-click command menus use native Tauri menus instead and need no snapshot substitution.

Right-clicking the embedded page replaces the browser engine's default menu with a KKTerm native menu. The always-available commands are `webview.back`, `webview.forward`, `webview.reload`, `dashboard.qrSaveImage`, and `workspace.sendEntirePanelToAi`. A link target adds `webview.openLinkInNewTab` for saved URL Connections plus `webview.openExternally` and `webview.copyLinkAddress`; a non-empty page selection adds `webview.copySelectedText`. The page bridge carries only bounded context metadata through the existing token-validated URL Session channel and does not grant external sites access to Tauri IPC.

The right-click `dashboard.qrSaveImage` command opens the native Save As dialog immediately, then captures the complete page to the selected PNG file. The URL toolbar screenshot menu's `webview.capturePageToClipboard` action uses the same full-page image generator and delivers the stitched image according to Settings → Screenshots Capture Mode. Full-page capture reads the document and viewport dimensions, scrolls through every horizontal and vertical tile, captures the real native WebView surface at each position, stitches the tiles at device-pixel resolution, and restores the original scroll position even when capture fails. Region capture remains a visible-area selection and uses the same configured delivery. `workspace.sendEntirePanelToAi` captures only the currently visible URL Pane and does not use full-page stitching. The stitcher rejects pages beyond the runtime's safe canvas dimensions instead of silently cropping them.

This deliberately does **not** use Tauri's `unstable` child-webview API. Enabling that feature changed the main KKTerm WebView2 host into a child HWND path, and Windows could restore focus to a native child/control instead of the terminal WebView2 content after Alt+Tab/app switch or minimize/restore. The visible terminal Pane could still look focused, but keyboard input did not reach xterm until the user clicked. The stable overlay-window path keeps URL browsing embedded while preserving the terminal's normal WebView2 focus forwarding.

If this surface changes, verify in the real Windows Tauri runtime that a focused terminal Pane accepts keyboard input immediately after Alt+Tab/app switch and minimize/restore. RDP remains the only workspace kind that uses screenshot-backed overlay parking.

When Settings → General → Debug → `settings.advancedDebugging` is enabled, `url.connection.debug.log` records URL Connection Session lifecycle, frontend DOM bounds, clipping, requested overlay bounds, native coordinate conversion, and WebView2 overlay window/client rectangles. Use it to compare the React-computed Pane bounds against the native overlay bounds when diagnosing visible gaps or misalignment.

Tutorial target: `webview.surface`.

## Toolbar

The URL Pane chrome follows the File Explorer (SFTP) Apple-esque design language: a token-driven light surface, hairline borders, and rounded translucent icon buttons. There is no sidebar.

- Connection identity: an unframed connection icon leads the toolbar (in the slot the File Explorer uses for its sidebar toggle). It shows the URL Connection's saved favicon when present, otherwise a globe glyph; its tooltip is the Connection name (or the current host for an ad-hoc URL Tab).
- Back: `webview.goBack` (`webview.back`)
- Forward: `webview.goForward` (`webview.forward`)
- Reload: `webview.reload`. F5 also reloads the current page when the embedded URL surface has keyboard focus. F5 is suppressed while KKTerm chrome such as the toolbar, Connection Tree, or another Pane has focus, because reloading the app shell can detach live Session chrome from its native URL surface.
- Address bar: `webview.address`, placeholder `webview.urlPlaceholder`. The bar accepts hosts without a scheme; the backend assumes `https://` when no scheme is present. A leading glyph reflects the current transport state: HTTPS uses a lock, plain HTTP uses a red unlocked glyph and address text, and non-http(s) drafts use the neutral globe.
- The address bar disables OS autocorrect, autocapitalization, and spellcheck in the KKTerm WebView on Windows and macOS so URLs and hostnames are not rewritten while typing. Keyboard/IME suggestions outside the WebView may still appear.
- Auto-refresh: `webview.autoRefresh` / `webview.autoRefreshOff`. Interval label `webview.autoRefreshSeconds`.
- Downloads: after the first download starts, `webview.downloads` appears immediately to the left of `webview.openExternally`. It opens a native menu so the menu remains visible above the owned URL WebView surface. Each entry shows the filename with `webview.downloadInProgress`, `webview.downloadSucceeded`, or `webview.downloadFailedItem`; `webview.openDownloadFolder` opens the effective download folder.
- Open externally: toolbar button `webview.openExternally` (opens the current URL in the OS default browser).
- In-page links: normal http(s) link clicks navigate inside the URL Pane. Links that request a new browser window, such as `target="_blank"`, open a new KKTerm Workspace Tab for that URL. Shift-click an http(s) link in the embedded page opens it in the OS default browser instead of navigating the URL Pane.
- Restore saved form data: `webview.fillSavedCredential` (disabled tooltip `webview.noSavedCredential`).
- Save form data: `webview.savePassword`, button title `webview.savePasswordTitle`.
- Send current URL Pane screenshot to AI Assistant: `workspace.sendEntirePanelToAi` (tutorial target `webview.sendToAi`). Status Bar confirmation: `workspace.sentToAi`.
- Screenshot menu: region capture selects a visible area; `webview.capturePageToClipboard` captures and stitches the page's complete scrollable width and height. Both follow Settings → Screenshots delivery behavior.
- Close the URL Pane/Tab: toolbar close button (tutorial target `webview.close`, label `workspace.closeTab`), shown only when a close handler is provided.
- Save/reset split Pane layout for a saved URL Connection from the Connection Tree right-click submenu `connections.layout` with `common.save` / `common.reset`.

Tutorial targets: `webview.toolbar`, `webview.address`, `webview.openExternally`, `webview.autoRefresh`, `webview.savePassword`, `webview.fillCredential`, `webview.sendToAi`, `webview.close`.

## Save & restore form data

KKTerm can remember everything typed into the current embedded page and write it
back on a later visit — not just a login. Pressing **Save form data** captures
every visible, restorable field (text inputs, textareas, `select` dropdowns, and
checkbox/radio state) plus the primary password field, without submitting the
form. There is no need for the page to have a password field at all, so search
forms, filters, and configuration screens can be saved too.

Each saved field is identified by a stable selector and its position among matching
elements, so the values land back in the right inputs when the page is reopened.
Saved form data is scoped by URL Connection plus a normalized page key. The key
uses the page origin and path while ignoring query strings and fragments, so
temporary authentication parameters such as `state`, `nonce`, or callback
fragments do not create a new saved entry. Multi-page authentication can be saved
one step at a time: save on the username page, continue, then save on the password
page.

Saving (toolbar **Save form data** button):

- `webview.capturingPassword` → `webview.savingPassword` → `webview.passwordSaved`.
- Nothing to save: `webview.savePasswordNoPasswordField` (no fillable fields with values were found). Malformed capture: `webview.savePasswordInvalidCapture`. Generic failure: `webview.savePasswordFailed`.

Restoring (toolbar **Restore saved form data** button, or automatically after a page
finishes loading) uses the saved entry for the current normalized page key, with
older single-entry credentials used as a fallback:

- `webview.fillingCredential` (in flight)
- `webview.credentialFilled` (success)
- `webview.noSavedCredential` (nothing stored for this Connection)

Manual restore writes every saved field, including the password and any toggles.
The automatic post-load restore is conservative: it only fills fields that are still
empty and leaves checkbox/radio/`select` state untouched so it never clobbers what a
page (or the user) has already set.

The primary password is the only captured value kept in the selected secret
store; each saved page step uses its own secret owner so password pages do not
overwrite username pages. All other field values are stored alongside the URL
Connection in SQLite and are never secrets.
Manage saved entries from either Settings → URL or Settings → Credentials
([15-settings.md](15-settings.md)). Both surfaces show the same single-row record
controls. Edit opens a compact dialog where each captured field is labelled by
its exact selector and matching-element occurrence. The primary password is
masked and can be revealed with its eye control. Other captured values are
visible by default; their lock control persists a masked presentation for the
next editor opening, and a masked value has a separate eye control for temporary
reveal. This mask flag is presentation metadata only: non-password values remain
in SQLite and are not moved into the credential backend. Delete removes both the
page metadata and its secret-store password.

## Downloads

Settings → URL → `settings.urlDownloadFolder` chooses the destination for new URL Sessions. Blank uses the operating system Downloads folder (`settings.urlDownloadFolderSystemDefault`); `settings.urlDownloadFolderBrowse` opens the native directory picker. Close and reopen an existing URL Tab after changing the setting.

The host webview emits download start and finish events. KKTerm avoids overwriting an existing same-named file by adding a numeric suffix, updates the toolbar's native Downloads menu, and shows transient status messages on the Status Bar:

- Started: `webview.downloadStarted`
- Complete: `webview.downloadComplete`
- Failed: `webview.downloadFailed`

The webview API does not expose portable byte counts, so the native menu reports lifecycle progress (Downloading / Complete / Failed), not a percentage. Reopen the menu to see status changes that occurred while it was open.

## Empty / runtime states

- `webview.noUrlConfigured` — Connection has no URL set.
- `webview.onlyDesktopRuntime`, `webview.desktopRuntimeOnly` — shown in a non-Tauri runtime (Vite preview); the WebView2 surface is unavailable.

## Screenshot target label

For [14-screenshots.md](14-screenshots.md): `webview.screenshotTarget`.
