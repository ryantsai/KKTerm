import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("backend URL sessions use stable overlay WebviewWindows", async () => {
  const source = await readFile(new URL("../src-tauri/src/webview.rs", import.meta.url), "utf8");

  assert.match(source, /Embedded URL-browser backend/);
  assert.match(source, /WebviewWindowBuilder::new/);
  assert.match(source, /\.owner\(&host_window\)/);
  assert.match(source, /\.skip_taskbar\(true\)/);
  assert.match(source, /\.visible\(false\)/);
  assert.match(source, /fn show_webview_window/);
  assert.doesNotMatch(source, /tauri_plugin_opener|open_url\(/);
  assert.doesNotMatch(source, /WebviewBuilder::new|\.add_child\(|\.build_as_child\(/);
});

test("F5 reload is blocked in the main shell but remains available to focused URL overlays", async () => {
  const [backend, lib] = await Promise.all([
    readFile(new URL("../src-tauri/src/webview.rs", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8"),
  ]);
  const urlSessionStartup = backend.match(
    /let mut builder = WebviewWindowBuilder::new\(app, &label,[\s\S]*?sessions\.insert\(/,
  )?.[0];

  assert.ok(urlSessionStartup, "URL WebView startup should exist");
  assert.match(backend, /SUPPRESS_SHELL_F5_RELOAD_SCRIPT/);
  assert.match(backend, /AcceleratorKeyPressedEventHandler/);
  assert.match(backend, /COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN/);
  assert.match(backend, /VK_F5/);
  assert.match(backend, /args\.SetHandled\(true\)/);
  assert.match(lib, /\.initialization_script_for_all_frames\(webview::SUPPRESS_SHELL_F5_RELOAD_SCRIPT\)/);
  assert.match(lib, /webview::configure_shell_refresh_shortcut\(&main_webview\)/);
  assert.doesNotMatch(urlSessionStartup, /SUPPRESS_SHELL_F5_RELOAD_SCRIPT/);
  assert.doesNotMatch(urlSessionStartup, /configure_shell_refresh_shortcut/);
});

test("frontend URL WebView runtime session ids stay within backend limits", async () => {
  const source = await readFile(
    new URL("../src/modules/workspace/connections/webview/WebViewWorkspace.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /function createWebviewSessionId/);
  assert.match(source, /useRef<string>\(createWebviewSessionId\(\)\)/);
  assert.doesNotMatch(
    source,
    /`webview-\$\{tab\.id\}/,
    "backend WebView session ids should not include variable-length tab ids",
  );
});

test("backend URL visibility commands track hidden overlay state", async () => {
  const source = await readFile(new URL("../src-tauri/src/webview.rs", import.meta.url), "utf8");

  const visibilityFunction = source.match(
    /pub fn set_visibility\(&self, request: SetWebviewVisibilityRequest\) -> Result<\(\), String> \{[\s\S]*?\n    pub fn focus/,
  )?.[0];

  assert.ok(visibilityFunction, "set_visibility should exist");
  assert.match(visibilityFunction, /show_webview\(session/);
  assert.match(visibilityFunction, /session\.visible = true;/);
  assert.match(visibilityFunction, /hide_webview\(&session\.window\)/);
  assert.match(visibilityFunction, /session\.visible = false;/);
  assert.doesNotMatch(
    visibilityFunction,
    /hide_other|for \(other_session_id, other_session\) in sessions\.iter_mut\(\)/,
    "showing one URL WebView must not hide another visible URL WebView",
  );
});

test("Dashboard catalog dialog suppresses embedded URL Connection WebViews", async () => {
  const source = await readFile(
    new URL("../src/modules/workspace/nativeOverlay.ts", import.meta.url),
    "utf8",
  );

  const webviewSelector = source.match(/const INTERSECTING_NATIVE_SURFACE_OVERLAY_SELECTOR = \[[\s\S]*?\]\.join/)?.[0];

  assert.ok(webviewSelector, "WebView blocking overlay selector should exist");
  assert.match(webviewSelector, /\.dw-catalog-backdrop/);
});

test("status notice popup suppresses embedded URL Connection WebViews", async () => {
  const source = await readFile(
    new URL("../src/modules/workspace/nativeOverlay.ts", import.meta.url),
    "utf8",
  );

  const webviewSelector = source.match(/const INTERSECTING_NATIVE_SURFACE_OVERLAY_SELECTOR = \[[\s\S]*?\]\.join/)?.[0];

  assert.ok(webviewSelector, "WebView blocking overlay selector should exist");
  // The native browser surface otherwise clips the top-anchored status popup, so the
  // visible popup must suppress the live WebView the same way the RDP host surface does.
  assert.match(webviewSelector, /\.status-popup/);
});

test("backend hides overlay URL WebViews instead of using unstable child APIs", async () => {
  const source = await readFile(new URL("../src-tauri/src/webview.rs", import.meta.url), "utf8");

  assert.match(source, /const HIDDEN_WEBVIEW_POSITION: f64 = -32_000\.0;/);
  assert.match(source, /fn hide_webview[\s\S]*?\.hide\(\)/);
  assert.match(source, /fn overlay_rect/);
  assert.doesNotMatch(source, /Window::add_child|\.add_child\(|\.build_as_child\(/);
});

test("backend shows macOS URL overlays without making them key", async () => {
  const source = await readFile(new URL("../src-tauri/src/webview.rs", import.meta.url), "utf8");
  const showFunction = source.match(
    /#\[cfg\(target_os = "macos"\)\]\s*fn show_webview_window\([\s\S]*?\n\}/,
  )?.[0];

  assert.ok(showFunction, "macOS should have its own URL overlay show helper");
  assert.match(showFunction, /orderFront/);
  assert.doesNotMatch(
    showFunction,
    /window\s*\.show\(\)|makeKeyAndOrderFront|set_focus/,
    "showing a URL overlay must not steal the main window's key focus from Connection Tree clicks",
  );
});

test("backend realizes hidden URL overlay windows before HWND-dependent no-activate show", async () => {
  const source = await readFile(new URL("../src-tauri/src/webview.rs", import.meta.url), "utf8");
  const hwndFunction = source.match(/fn webview_hwnd\(window: &WebviewWindow\)[\s\S]*?\n\}/)?.[0];
  const showFunction = source.match(/fn show_webview_window\(window: &WebviewWindow\) -> Result<\(\), String> \{[\s\S]*?\n\}/)?.[0];

  assert.ok(hwndFunction, "Windows webview HWND helper should exist");
  assert.ok(showFunction, "Windows show_webview_window should exist");
  assert.match(hwndFunction, /match window\.hwnd\(\)/);
  assert.match(hwndFunction, /window\s*\.show\(\)/);
  assert.match(hwndFunction, /failed to get URL webview HWND after realize/);
  assert.match(showFunction, /webview_hwnd\(window\)\?/);
  assert.match(showFunction, /SW_SHOWNOACTIVATE/);
  assert.match(showFunction, /SWP_NOACTIVATE/);
});

test("backend applies URL overlay bounds through a native screen rect before client inset compensation", async () => {
  const source = await readFile(new URL("../src-tauri/src/webview.rs", import.meta.url), "utf8");
  const positionFunction = Array.from(source.matchAll(/fn position_webview_window\([\s\S]*?\n\}/g))
    .map((match) => match[0])
    .find((candidate) => candidate.includes("SetWindowPos"));

  assert.ok(positionFunction, "Windows URL overlay positioning helper should exist");
  assert.match(positionFunction, /SetWindowPos/);
  assert.match(positionFunction, /position\.x/);
  assert.match(positionFunction, /position\.y/);
  assert.match(positionFunction, /size\.width as i32/);
  assert.match(positionFunction, /size\.height as i32/);
  assert.doesNotMatch(positionFunction, /client_offset/);
  assert.doesNotMatch(positionFunction, /GetClientRect|GetWindowRect/);
  assert.doesNotMatch(
    positionFunction,
    /\.set_position\(/,
    "Windows URL overlays should use the same native HWND positioning primitive as RDP",
  );
});

test("backend strips Windows URL overlay non-client chrome before positioning", async () => {
  const source = await readFile(new URL("../src-tauri/src/webview.rs", import.meta.url), "utf8");
  const positionFunction = Array.from(source.matchAll(/fn position_webview_window\([\s\S]*?\n\}/g))
    .map((match) => match[0])
    .find((candidate) => candidate.includes("SetWindowPos"));

  assert.ok(positionFunction, "Windows URL overlay positioning helper should exist");
  assert.match(positionFunction, /configure_webview_window_client_chrome\(hwnd\)/);
  assert.match(source, /fn configure_webview_window_client_chrome/);
  assert.match(source, /WS_CAPTION/);
  assert.match(source, /WS_THICKFRAME/);
  assert.match(source, /SWP_FRAMECHANGED/);
  assert.doesNotMatch(positionFunction, /backend\.window\.client_compensated/);
});

test("backend always refreshes the Windows overlay client frame after installing its subclass", async () => {
  const source = await readFile(new URL("../src-tauri/src/webview.rs", import.meta.url), "utf8");
  const configureFunction = source.match(
    /fn configure_webview_window_client_chrome\([\s\S]*?\n\}\n\n#\[cfg\(target_os = "windows"\)\]\nfn log_positioned_webview_window/,
  )?.[0];

  assert.ok(configureFunction, "Windows overlay client-chrome helper should exist");
  const styleMutationIndex = configureFunction.indexOf("let _ = SetWindowLongPtrW");
  const frameRefreshIndex = configureFunction.indexOf("SetWindowPos(");
  assert.ok(styleMutationIndex >= 0 && frameRefreshIndex > styleMutationIndex);
  assert.ok(
    configureFunction.slice(styleMutationIndex, frameRefreshIndex).includes("\n    }\n"),
    "SWP_FRAMECHANGED must run even when Tauri already removed the window style bits",
  );
});

test("backend positions URL overlays from the host WebView client origin", async () => {
  const source = await readFile(new URL("../src-tauri/src/webview.rs", import.meta.url), "utf8");
  const overlayFunction = source.match(/fn overlay_rect\([\s\S]*?\n\}/)?.[0];
  const hostOriginFunction = source.match(/fn host_content_origin[\s\S]*?ClientToScreen[\s\S]*?\n\}/)?.[0];

  assert.ok(overlayFunction, "overlay_rect should exist");
  assert.match(overlayFunction, /host_content_origin\(host_window\)/);
  assert.doesNotMatch(
    overlayFunction,
    /outer_position\(\)/,
    "DOM client coordinates should be offset from the host WebView content origin",
  );
  assert.ok(hostOriginFunction, "host_content_origin should resolve the client origin via ClientToScreen on Windows");
  assert.match(hostOriginFunction, /inner_position\(\)/, "host_content_origin should fall back to inner_position");
});

test("frontend retries the overlay show while the native handle is still realizing", async () => {
  const source = await readFile(
    new URL("../src/modules/workspace/connections/webview/WebViewWorkspace.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const WEBVIEW_HANDLE_NOT_READY_PATTERN = /);
  assert.match(source, /const WEBVIEW_SHOW_RETRY_DELAYS_MS = \[/);
  const requestVisibility = source.match(/const requestWebviewVisibility = \([\s\S]*?\n    \}\);/)?.[0];
  assert.ok(requestVisibility, "requestWebviewVisibility should exist");
  assert.match(requestVisibility, /request\.visible/);
  assert.match(requestVisibility, /WEBVIEW_HANDLE_NOT_READY_PATTERN\.test\(message\)/);
  assert.match(requestVisibility, /attempt < WEBVIEW_SHOW_RETRY_DELAYS_MS\.length/);
  assert.match(requestVisibility, /requestWebviewVisibility\(request, attempt \+ 1\)/);
  assert.match(source, /const visibilityUpdate = requestWebviewVisibility\(\{/);
});

test("frontend marks URL Connections live as soon as the WebView Session starts opening", async () => {
  const source = await readFile(
    new URL("../src/modules/workspace/connections/webview/WebViewWorkspace.tsx", import.meta.url),
    "utf8",
  );
  const startupEffect = source.match(/useEffect\(\(\) => \{[\s\S]*?start_webview_session[\s\S]*?\n  \}, \[\]\);/)?.[0];

  assert.match(source, /const markConnectionSessionStarted = useWorkspaceStore/);
  assert.match(source, /const markConnectionSessionEnded = useWorkspaceStore/);
  assert.match(source, /connectionSessionCountedRef/);
  assert.match(source, /const markWebviewConnectionStarted = \(\) => \{/);
  assert.match(source, /const markWebviewConnectionEnded = \(\) => \{/);
  assert.ok(startupEffect, "URL WebView startup effect should exist");
  assert.match(startupEffect, /sessionStartingRef\.current = true;[\s\S]*?markWebviewConnectionStarted\(\);/);
  assert.match(startupEffect, /\.catch\(\(error\) => \{[\s\S]*?markWebviewConnectionEnded\(\);/);
  assert.match(startupEffect, /releaseWebviewSession\(sessionId\);[\s\S]*?markWebviewConnectionEnded\(\);/);
});

test("URL WebView release logs include frontend and backend close lifecycle", async () => {
  const frontend = await readFile(
    new URL("../src/modules/workspace/connections/webview/WebViewWorkspace.tsx", import.meta.url),
    "utf8",
  );
  const backend = await readFile(new URL("../src-tauri/src/webview.rs", import.meta.url), "utf8");

  assert.match(frontend, /frontend\.session\.release\.requested/);
  assert.match(frontend, /frontend\.session\.release\.deferred/);
  assert.match(frontend, /frontend\.session\.release\.close_request/);
  assert.match(frontend, /frontend\.session\.release\.closed/);
  assert.match(frontend, /frontend\.session\.release\.close_error/);
  assert.match(backend, /backend\.session\.close\.request/);
  assert.match(backend, /backend\.session\.close\.missing/);
  assert.match(backend, /backend\.session\.close\.ok/);
  assert.match(backend, /backend\.session\.close\.error/);
});

test("frontend repushes URL overlay bounds on native window move", async () => {
  const source = await readFile(
    new URL("../src/modules/workspace/connections/webview/WebViewWorkspace.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const repushOnNativeMove = \(\) => \{/);
  assert.match(source, /lastBoundsRef\.current = null;/);
  assert.match(source, /listen\("tauri:\/\/move", repushOnNativeMove\)/);
  assert.match(source, /listen\("tauri:\/\/resize", repushOnNativeMove\)/);
});

test("frontend opens target blank URL navigations in new Workspace Tabs", async () => {
  const source = await readFile(
    new URL("../src/modules/workspace/connections/webview/WebViewWorkspace.tsx", import.meta.url),
    "utf8",
  );
  const listener = source.match(/listen<WebviewNewWindowEvent>\("webview-new-window",[\s\S]*?\),\r?\n      listen<WebviewTitleChangedEvent>/)?.[0];

  assert.ok(listener, "webview-new-window listener should exist");
  assert.match(source, /const openUrlInNewTab = useWorkspaceStore/);
  assert.match(listener, /openUrlInNewTab\(tab\.connection,\s*event\.payload\.url/);
  assert.doesNotMatch(
    listener,
    /webview_navigate/,
    "target=_blank should not silently replace the current URL Session",
  );
});

test("store creates top-level WebView Tabs for URL new-tab launches", async () => {
  const source = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");
  const openUrlInNewTab = source.match(/openUrlInNewTab: \(connection, url, options\) => \{[\s\S]*?\r?\n  \},\r?\n  openChildConnection/)?.[0];
  const openConnectionInNewTab = source.match(/openConnectionInNewTab: \(connection, options\) => \{[\s\S]*?\r?\n  \},\r?\n  openUrlInNewTab/)?.[0];
  const openUrlConnection = source.match(/openUrlConnection: \(connection\) => \{[\s\S]*?openSshPortForwardBrowser/)?.[0];

  assert.ok(openUrlInNewTab, "openUrlInNewTab action should exist");
  assert.ok(openConnectionInNewTab, "openConnectionInNewTab action should exist");
  assert.ok(openUrlConnection, "openUrlConnection action should exist");
  assert.match(openConnectionInNewTab, /connection\.type === "url"[\s\S]*?get\(\)\.openUrlInNewTab/);
  assert.match(openUrlInNewTab, /kind: "webview"/);
  assert.match(openUrlInNewTab, /panes: \[\]/);
  assert.match(openUrlInNewTab, /url: nextUrl/);
  assert.match(openUrlConnection, /kind: "webview"/);
  assert.doesNotMatch(openUrlConnection, /kind: "terminal"/);
});

test("Dashboard overlays use URL snapshot-and-hide suppression", async () => {
  const page = await readFile(new URL("../src/modules/dashboard/DashboardPage.tsx", import.meta.url), "utf8");
  const canvas = await readFile(new URL("../src/modules/dashboard/view/DashboardCanvas.tsx", import.meta.url), "utf8");
  const frame = await readFile(new URL("../src/modules/dashboard/view/WidgetFrame.tsx", import.meta.url), "utf8");
  const body = await readFile(new URL("../src/modules/dashboard/view/WidgetBody.tsx", import.meta.url), "utf8");
  const registry = await readFile(new URL("../src/modules/dashboard/registry/builtInRegistry.ts", import.meta.url), "utf8");
  const connectionWidget = await readFile(
    new URL("../src/modules/dashboard/widgets/builtin/connections/ConnectionWidget.tsx", import.meta.url),
    "utf8",
  );
  const nativeOverlay = await readFile(
    new URL("../src/modules/workspace/nativeOverlay.ts", import.meta.url),
    "utf8",
  );

  for (const source of [page, canvas, frame, body, registry, connectionWidget]) {
    assert.doesNotMatch(source, /suppressNativeWebviews/);
  }
  assert.match(connectionWidget, /<WebViewWorkspace isActive=\{isViewActive\} tab=\{tab\}/);
  for (const selector of [
    ".dw-catalog-backdrop",
    ".dw-customize-dismiss-layer",
    ".dashboard-tab-gradient-popover",
    ".dw-bg-popover",
    ".kk-dlg-backdrop",
  ]) {
    assert.match(nativeOverlay, new RegExp(`"${selector.replaceAll(".", "\\.")}"`));
  }
});
