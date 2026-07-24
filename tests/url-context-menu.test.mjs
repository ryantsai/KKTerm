import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backend = readFileSync("src-tauri/src/webview.rs", "utf8");
const frontend = readFileSync(
  "src/modules/workspace/connections/webview/WebViewWorkspace.tsx",
  "utf8",
);
const manual = readFileSync("docs/manual/08-url-webview.md", "utf8");
const screenshotMenu = readFileSync("src/modules/workspace/ScreenshotMenu.tsx", "utf8");
const tauriTypes = readFileSync("src/lib/tauri.ts", "utf8");
const tauriBackend = readFileSync("src-tauri/src/lib.rs", "utf8");
const screenshotBackend = readFileSync("src-tauri/src/screenshot.rs", "utf8");

test("URL page right-click replaces the engine menu through a token-validated bridge", () => {
  assert.match(backend, /const CONTEXT_MENU_AGENT/);
  assert.match(backend, /document\.addEventListener\("contextmenu"/);
  assert.match(backend, /event\.preventDefault\(\);[\s\S]*event\.stopImmediatePropagation\(\);/);
  assert.match(backend, /linkUrl = url\.href\.slice\(0, 4096\)/);
  assert.match(backend, /slice\(0, 65536\)/);
  assert.match(backend, /context_menu_agent\(&external_link_token\)\?/);
  assert.match(frontend, /payload\.token !== expectedToken/);
});

test("URL page context menu uses native commands for page, link, save, and AI actions", () => {
  assert.match(frontend, /showNativeContextMenu\(/);
  assert.match(frontend, /handleSimple\("webview_go_back"\)/);
  assert.match(frontend, /handleSimple\("webview_go_forward"\)/);
  assert.match(frontend, /handleSimple\("webview_reload"\)/);
  assert.match(frontend, /openUrlInNewTab/);
  assert.match(frontend, /openExternalUrl\(payload\.linkUrl!/);
  assert.match(frontend, /writeToClipboard\(text\)/);
  assert.match(frontend, /label: t\("dashboard\.qrSaveImage"\)/);
  assert.match(frontend, /action: \(\) => void saveFullWebviewPageAs\(\)/);
  assert.match(frontend, /label: t\("webview\.openExternally"\)/);
  assert.match(frontend, /captureWebviewScreenshotForAssistant/);
});

test("URL full-page capture tiles both axes, stitches at device scale, and restores scrolling", () => {
  assert.match(backend, /window\.__KKTERM_URL_PAGE_CAPTURE__/);
  assert.match(backend, /window\.scrollTo/);
  assert.match(backend, /pageWidth: Math\.max/);
  assert.match(backend, /pageHeight: Math\.max/);
  assert.match(frontend, /pageCaptureTilePositions\(initialState\.pageWidth/);
  assert.match(frontend, /pageCaptureTilePositions\(initialState\.pageHeight/);
  assert.match(frontend, /context\.drawImage\(/);
  assert.match(frontend, /canvas\.toDataURL\("image\/png"\)/);
  assert.match(frontend, /requestPageCaptureState\(initialState\.x, initialState\.y\)/);
  assert.match(frontend, /finally \{[\s\S]*fullPageCaptureInFlightRef\.current = false/);
  assert.match(tauriTypes, /request_webview_page_capture_state/);
  assert.match(tauriTypes, /deliver_screenshot_data_url/);
  assert.match(tauriBackend, /request_webview_page_capture_state/);
  assert.match(tauriBackend, /deliver_screenshot_data_url/);
  assert.match(screenshotBackend, /write_rgba_to_clipboard/);
});

test("URL toolbar delivers the full page through screenshot settings while the context menu saves it immediately", () => {
  assert.match(screenshotMenu, /onCaptureEntirePanel/);
  assert.match(
    frontend,
    /onCaptureEntirePanel=\{captureFullWebviewPageWithSettings\}/,
  );
  assert.match(frontend, /selectPngSavePath\(filename,[\s\S]*captureFullWebviewPage\(\)/);
  assert.match(frontend, /writeDataUrlFile\(path, dataUrl\)/);
  assert.match(frontend, /captureFullWebviewPageWithSettings\(\)[\s\S]*deliver_screenshot_data_url/);
});

test("URL Send to AI captures only the visible pane bounds", () => {
  assert.match(
    frontend,
    /captureWebviewScreenshotForAssistant\(\)[\s\S]*workspaceRef\.current[\s\S]*getBoundingClientRect\(\)[\s\S]*capture_screenshot_for_assistant/,
  );
  const assistantCapture = frontend.match(
    /async function captureWebviewScreenshotForAssistant\(\)([\s\S]*?)\n  function /,
  )?.[1] ?? "";
  assert.doesNotMatch(assistantCapture, /captureFullWebviewPage/);
});

test("URL manual documents the customized native page menu", () => {
  assert.match(manual, /replaces the browser engine's default menu with a KKTerm native menu/);
  assert.match(manual, /webview\.openLinkInNewTab/);
  assert.match(manual, /webview\.copySelectedText/);
  assert.match(manual, /scrolls through every horizontal and vertical tile/);
});
